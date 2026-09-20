import {
  Injectable,
  Logger,
  OnModuleInit,
  OnApplicationBootstrap,
  Inject,
} from '@nestjs/common';
import { CommandRegistryService } from './command-registry.service';
import { TenantService } from '../tenant/tenant.service';
import { MezonClient } from 'mezon-sdk';
import { extractMessageText } from '../../shared/text-extract.utils';
import { buildMessageContent } from '../../shared/message.utils';

/**
 * BotGateway is the central message dispatcher.
 * It listens for Mezon events and routes them through the tenant + command system.
 *
 * Nezon's @Command decorator is NOT used here because we need dynamic dispatch
 * (commands are resolved at runtime per-tenant from the database).
 * Instead, we listen to raw onChannelMessage and onAddClanUser events.
 */
@Injectable()
export class BotGateway implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(BotGateway.name);

  constructor(
    private readonly commandRegistry: CommandRegistryService,
    private readonly tenantService: TenantService,
    @Inject(MezonClient) private readonly client: MezonClient,
  ) {}

  async onModuleInit() {
    const botId =
      process.env.MEZON_BOT_ID || (this.client as any).clientId || '';

    // ── Listen for channel messages → dispatch to command registry ──
    this.client.onChannelMessage(async (message: any) => {
      try {
        // Ignore bot's own messages
        if (
          message.sender_id === botId ||
          message.sender_id === (this.client as any).clientId
        ) {
          return;
        }

        const clanId = message.clan_id || message.clanId || '';
        const text = extractMessageText(message.content);

        this.logger.log(
          `📩 [BotGateway] Received message: "${text}" from ${message.sender_id} in clan=${clanId || 'DM'}`,
        );

        if (!clanId) return;

        // Auto join channel if not already joined
        const channelId = message.channel_id || message.channelId;
        if (channelId) {
          try {
            const socket = (this.client as any).socketManager?.socket;
            if (socket) {
              await socket.joinChat(clanId, channelId, 1, true);
            }
          } catch {
            // ignore
          }
        }

        const tenant = await this.tenantService.resolveByClanId(clanId);
        if (!tenant) {
          this.logger.warn(
            `⚠️ Clan "${clanId}" is not registered as a tenant. Received: "${text}"`,
          );
          await this.handleUnregisteredClanMessage(clanId, message, text);
          return;
        }

        await this.commandRegistry.dispatch(tenant, message);
      } catch (err) {
        this.logger.error('Error handling channel message:', err);
      }
    });

    // ── Listen for new clan members → send welcome DM ──
    this.client.onAddClanUser(async (event: any) => {
      try {
        const clanId = event?.clan_id || '';
        const userId = event?.user?.user_id;
        const username =
          event?.user?.display_name || event?.user?.username || 'bạn';

        if (!clanId || !userId) return;

        const tenant = await this.tenantService.resolveByClanId(clanId);
        if (!tenant) return;

        // Build welcome message using tenant config
        const prefix = tenant.parsedConfig.command_prefix || '*';
        const welcomeText =
          tenant.parsedConfig.welcome_message ||
          `🎉 **Chào mừng @${username} đến với ${tenant.name}!**\n\n` +
            `• Gõ \`${prefix}thi\` để bắt đầu bài thi ngay\n` +
            `• Gõ \`${prefix}ketqua\` để xem kết quả bài thi\n` +
            `• Gõ \`${prefix}lichsu\` để xem lịch sử các lần thi`;

        // Send DM
        const user =
          this.client.users.get(userId) ||
          (await this.client.users.fetch(userId));
        if (user) {
          await user.sendDM({ t: welcomeText });
          this.logger.log(
            `👋 Sent welcome DM to ${username} (tenant: ${tenant.name})`,
          );
        }
      } catch (err) {
        this.logger.error('Error handling onAddClanUser:', err);
      }
    });

    // ── When MezonClient fires 'ready', sync all clan channels ──
    this.client.on('ready', () => {
      this.logger.log('📡 [BotGateway] MezonClient "ready" event received!');
      setTimeout(() => this.joinAllChannels(), 1500);
    });
  }

  async onApplicationBootstrap() {
    this.logger.log('🔗 BotGateway ready — listening for messages and events');
    // Ensure channels are joined after bootstrap
    setTimeout(() => this.joinAllChannels(), 3000);
  }

  /**
   * Handle messages from clans that are not registered in the database yet.
   */
  private async handleUnregisteredClanMessage(
    clanId: string,
    message: any,
    text: string,
  ) {
    const trimmed = text.trim();
    if (trimmed.startsWith('*admin') || trimmed.startsWith('!admin')) {
      await this.commandRegistry.dispatchUnregistered(clanId, message, trimmed);
      return;
    }

    if (trimmed.startsWith('*') || trimmed.startsWith('!')) {
      await this.sendEphemeral(
        message,
        `⚠️ **Clan này chưa được đăng ký với Bot!**\n\n` +
          `👉 Quản trị viên vui lòng gõ lệnh sau để đăng ký:\n` +
          `\`*admin register <tên TT> <web_app_url> <api_secret> <bot_secret>\`\n\n` +
          `*Ví dụ:*\n` +
          `\`*admin register "NCC English" http://localhost:3000 my_secret my_secret\``,
      );
    }
  }

  /** Join all channels across all accessible clans */
  async joinAllChannels() {
    try {
      const clans = Array.from(this.client.clans.values());
      if (clans.length === 0) {
        this.logger.warn('No clans found in client cache yet');
        return;
      }

      this.logger.log(
        `🔍 [BotGateway] Syncing channels for ${clans.length} clan(s)...`,
      );
      for (const clan of clans) {
        try {
          await clan.loadChannels();
          const channels = Array.from(clan.channels.values());
          let joinedCount = 0;
          for (const ch of channels) {
            try {
              const socket = (this.client as any).socketManager?.socket;
              if (socket) {
                await socket.joinChat(
                  clan.id,
                  ch.id,
                  ch.channel_type || 1,
                  !ch.is_private,
                );
                joinedCount++;
              }
            } catch {
              // ignore per-channel join failures
            }
          }
          this.logger.log(
            `🔗 [BotGateway] Joined ${joinedCount} channel(s) in clan: "${clan.name || clan.id}"`,
          );
        } catch (err) {
          this.logger.warn(`Could not load channels for clan ${clan.id}:`, err);
        }
      }
    } catch (err) {
      this.logger.warn('Could not enumerate clans:', err);
    }
  }

  private async sendEphemeral(message: any, text: string) {
    try {
      const clanId = message.clan_id || message.clanId || '';
      const channelId = message.channel_id || message.channelId || '';
      const channel = await this.resolveChannel(channelId, clanId);
      if (channel) {
        await channel.sendEphemeral(
          message.sender_id,
          buildMessageContent(text),
        );
        return;
      }
    } catch {
      // ignore
    }

    try {
      const user =
        this.client.users.get(message.sender_id) ||
        (await this.client.users.fetch(message.sender_id));
      if (user) await user.sendDM(buildMessageContent(text));
    } catch (err) {
      this.logger.error('DM fallback failed:', err);
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
