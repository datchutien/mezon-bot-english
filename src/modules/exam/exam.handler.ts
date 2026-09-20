import { Injectable, Logger, Inject } from '@nestjs/common';
import { MezonClient } from 'mezon-sdk';
import {
  CommandHandler,
  CommandContext,
} from '../../core/command-registry/interfaces/command-handler.interface';
import { WebAppClientService } from '../../core/web-app-client/web-app-client.service';
import { buildMessageContent, buildLinkButton } from '../../shared/message.utils';

/**
 * *thi — Creates a random test and sends the launch link as an ephemeral message.
 */
@Injectable()
export class ExamHandler implements CommandHandler {
  readonly name = 'thi';
  readonly defaultAliases = ['testingnow', 'testnow', 'starttest', 'test'];
  readonly description = 'Tạo link bài thi ngẫu nhiên';

  private readonly logger = new Logger(ExamHandler.name);

  constructor(
    private readonly webApp: WebAppClientService,
    @Inject(MezonClient) private readonly client: MezonClient,
  ) {}

  async execute(ctx: CommandContext): Promise<void> {
    const { tenant, message } = ctx;

    try {
      const result = await this.webApp.createTest(
        tenant,
        message.sender_id,
        message.username || message.display_name,
      );

      if (!result.success || !result.launchUrl) {
        await this.sendEphemeral(
          message,
          `⚠️ Không thể tạo bài thi: ${result.error || 'Unknown error'}`,
        );
        return;
      }

      const topicTitle = result.topic?.title || 'Random Topic';
      const msg =
        `🎙️ **BÀI THI ĐÃ SẴN SÀNG!**\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📋 **Topic:** ${topicTitle}\n` +
        `⏱️ **Format:** Full 3-Part Assessment\n` +
        `🆔 **Attempt ID:** \`${result.attemptId}\`\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🚀 Bấm nút bên dưới để vào phòng thi:\n` +
        `${result.launchUrl}\n\n` +
        `💡 Hãy đảm bảo microphone hoạt động tốt!`;

      const components = [buildLinkButton('btn_start_test', '🚀 Vào thi ngay', result.launchUrl)];

      await this.sendEphemeral(message, msg, components);
      this.logger.log(
        `✅ Sent test link to ${message.sender_id} (tenant: ${tenant.name})`,
      );
    } catch (err) {
      this.logger.error('Error in *thi command:', err);
      await this.sendEphemeral(
        message,
        '⚠️ Đã xảy ra lỗi khi tạo bài thi. Vui lòng thử lại sau!',
      );
    }
  }

  /** Send an ephemeral message in the channel (only visible to the sender) */
  private async sendEphemeral(
    message: any,
    text: string,
    components?: any[],
  ) {
    try {
      const clanId = message.clan_id || message.clanId || '';
      const channelId = message.channel_id || message.channelId || '';
      const channel = await this.resolveChannel(channelId, clanId);
      if (channel) {
        await channel.sendEphemeral(
          message.sender_id,
          buildMessageContent(text, components),
        );
        return;
      }
    } catch (err) {
      this.logger.warn('Ephemeral failed, falling back to DM:', err);
    }

    // Fallback to DM
    try {
      const user =
        this.client.users.get(message.sender_id) ||
        (await this.client.users.fetch(message.sender_id));
      if (user) {
        await user.sendDM(buildMessageContent(text, components));
      }
    } catch (err) {
      this.logger.error('DM fallback also failed:', err);
    }
  }

  private async resolveChannel(channelId: string, clanId: string) {
    if (clanId) {
      const clan = this.client.clans.get(clanId);
      if (clan) {
        await clan.loadChannels();
        return clan.channels.get(channelId) || null;
      }
    }
    try {
      return (
        this.client.channels.get(channelId) ||
        (await this.client.channels.fetch(channelId))
      );
    } catch {
      return null;
    }
  }
}
