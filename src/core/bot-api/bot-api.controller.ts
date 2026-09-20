import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Headers,
  UnauthorizedException,
  Logger,
  Inject,
} from "@nestjs/common";
import { TenantService } from "../tenant/tenant.service";
import { WebAppClientService } from "../web-app-client/web-app-client.service";
import { MezonClient } from "mezon-sdk";
import {
  buildMessageContent,
  buildLinkButton,
} from "../../shared/message.utils";
import { ScoreResult } from "../web-app-client/web-app-client.types";

@Controller()
export class BotApiController {
  private readonly logger = new Logger(BotApiController.name);

  constructor(
    private readonly tenantService: TenantService,
    private readonly webAppClient: WebAppClientService,
    @Inject(MezonClient) private readonly client: MezonClient,
  ) {}

  /** Resolve tenant from the x-bot-secret header */
  private async resolveTenant(secret: string | undefined) {
    if (!secret) throw new UnauthorizedException("Missing x-bot-secret");
    const tenant = await this.tenantService.findByBotVerifySecret(secret);
    if (!tenant) throw new UnauthorizedException("Invalid bot secret");
    return tenant;
  }

  /** Web app calls this to verify if a user is a clan member */
  @Get("/verify")
  async verifyMembership(
    @Headers("x-bot-secret") secret: string,
    @Query("userId") userId: string,
  ) {
    await this.resolveTenant(secret);
    this.logger.log(`/verify called for userId=${userId}`);
    return { isMember: true };
  }

  /**
   * Web app calls this to make the bot send a result notification via Mezon.
   * Fetches result details (scores, breakdown, feedback) and sends an ephemeral
   * message to the exam channel (or DM fallback), matching *ketqua <attemptId>.
   */
  @Post("/notify-result")
  async notifyResult(
    @Headers("x-bot-secret") secret: string,
    @Body() body: { userId: string; attemptId: string; channelId?: string },
  ) {
    const tenant = await this.resolveTenant(secret);

    if (!body.userId || !body.attemptId) {
      return {
        success: false,
        message: "Missing userId or attemptId in request body",
      };
    }

    this.logger.log(
      `📢 [notify-result] user=${body.userId} attempt=${body.attemptId} channel=${body.channelId || "default"} tenant=${tenant.name}`,
    );

    // 1. Fetch result from web app using attemptId
    let res;
    try {
      res = await this.webAppClient.getResultById(
        tenant,
        body.userId,
        body.attemptId,
      );
    } catch (err: any) {
      this.logger.error(`Failed to fetch result from web app: ${err.message}`);
      return {
        success: false,
        message: `Failed to fetch result from web app: ${err.message}`,
      };
    }

    if (!res.success || !res.attempt) {
      this.logger.warn(
        `Web app returned unsuccessful result for attempt ${body.attemptId}: ${res.error}`,
      );
      return { success: false, message: res.error || "Attempt not found" };
    }

    // 2. Format result message & components (same as *ketqua)
    const { attempt, detailsUrl } = res;
    const text = this.formatResult(attempt);
    const components = detailsUrl
      ? [
          buildLinkButton(
            "btn_view_result",
            "📊 Xem báo cáo chi tiết",
            detailsUrl,
          ),
        ]
      : [];

    // 3. Resolve target channel: from request body, env, or tenant config
    const targetChannelId =
      body.channelId ||
      process.env.MEZON_EXAM_CHANNEL_ID ||
      (tenant.config as any)?.exam_channel_id ||
      "";

    let channel: any = null;
    if (targetChannelId) {
      channel = await this.resolveChannel(targetChannelId, tenant.clanId);
    }

    // 4. Send message: Try ephemeral in target exam channel first, fallback to DM
    let sentMethod = "";
    if (channel) {
      try {
        // Ensure socket has joined this channel
        const socket = (this.client as any).socketManager?.socket;
        if (socket && tenant.clanId) {
          try {
            await socket.joinChat(
              tenant.clanId,
              channel.id,
              channel.channel_type || 1,
              !channel.is_private,
            );
          } catch {
            // ignore join failure
          }
        }

        await channel.sendEphemeral(
          body.userId,
          buildMessageContent(text, components),
        );
        sentMethod = `ephemeral in channel ${channel.id}`;
        this.logger.log(
          `✅ Sent result notification (ephemeral) to ${body.userId} in channel ${channel.id}`,
        );
      } catch (err) {
        this.logger.warn(
          `Ephemeral send failed in channel ${channel.id}, falling back to DM:`,
          err,
        );
      }
    }

    if (!sentMethod) {
      try {
        const user =
          this.client.users.get(body.userId) ||
          (await this.client.users.fetch(body.userId));
        if (user) {
          await user.sendDM(buildMessageContent(text, components));
          sentMethod = "DM";
          this.logger.log(`✅ Sent result notification (DM) to ${body.userId}`);
        }
      } catch (dmErr) {
        this.logger.error(`DM fallback failed for user ${body.userId}:`, dmErr);
      }
    }

    if (sentMethod) {
      return {
        success: true,
        message: `Notification sent via ${sentMethod}`,
      };
    } else {
      return {
        success: false,
        message: "Could not send notification (channel and DM both failed)",
      };
    }
  }

  private formatResult(attempt: {
    id: string;
    topic_title: string;
    submitted_at: string;
    score_result: ScoreResult | null;
  }): string {
    if (!attempt.score_result) {
      return (
        `⏳ **Bài thi đang được chấm điểm**\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 Mã bài thi: \`${attempt.id}\`\n` +
        `📋 Chủ đề: ${attempt.topic_title || "N/A"}\n\n` +
        `Vui lòng thử lại sau ít phút!`
      );
    }

    const s = attempt.score_result;
    const date = attempt.submitted_at
      ? new Date(attempt.submitted_at).toLocaleDateString("vi-VN")
      : "N/A";

    const overall = s.overall_band ?? s.overall ?? 0;

    let text =
      `📊 **KẾT QUẢ BÀI THI IELTS SPEAKING**\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🆔 Mã bài thi: \`${attempt.id}\`\n` +
      `📅 Ngày thi: ${date}\n` +
      `📋 Chủ đề: ${attempt.topic_title || "N/A"}\n` +
      `🎯 Điểm tổng quan: **${Number(overall).toFixed(1)}**`;

    text += `\n━━━━━━━━━━━━━━━━━━━━`;
    return text;
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

  /** Health check */
  @Get("/health")
  health() {
    return { status: "ok", uptime: process.uptime() };
  }
}
