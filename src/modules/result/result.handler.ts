import { Injectable, Logger, Inject } from "@nestjs/common";
import { MezonClient } from "mezon-sdk";
import {
  CommandHandler,
  CommandContext,
} from "../../core/command-registry/interfaces/command-handler.interface";
import { WebAppClientService } from "../../core/web-app-client/web-app-client.service";
import { ScoreResult } from "../../core/web-app-client/web-app-client.types";
import {
  buildMessageContent,
  buildLinkButton,
} from "../../shared/message.utils";

// ─────────────────────────────────────────────
// *ketqua / *ketqua <attempt-id>
// ─────────────────────────────────────────────

@Injectable()
export class ResultHandler implements CommandHandler {
  readonly name = "ketqua";
  readonly defaultAliases = ["result", "kq", "score"];
  readonly description = "Xem kết quả bài thi IELTS Speaking";

  private readonly logger = new Logger(ResultHandler.name);

  constructor(
    private readonly webApp: WebAppClientService,
    @Inject(MezonClient) private readonly client: MezonClient,
  ) {}

  async execute(ctx: CommandContext): Promise<void> {
    const { tenant, message, args } = ctx;

    try {
      const res = args[0]
        ? await this.webApp.getResultById(tenant, message.sender_id, args[0])
        : await this.webApp.getLatestResult(tenant, message.sender_id);

      if (!res.success || !res.attempt) {
        const prefix = tenant.parsedConfig.command_prefix || "*";
        const errMsg =
          res.error === "User not found"
            ? `⚠️ Tài khoản Mezon chưa có trong hệ thống. Hãy vào web app đăng nhập trước!`
            : res.error === "No submitted attempts found"
              ? `ℹ️ Bạn chưa có bài thi nào. Gõ \`${prefix}thi\` để bắt đầu!`
              : `⚠️ ${res.error || "Không tìm thấy kết quả"}`;
        await this.sendEphemeral(message, errMsg);
        return;
      }

      const { attempt, detailsUrl } = res;
      const text = this.formatResult(attempt, detailsUrl!);
      const components = detailsUrl
        ? [
            buildLinkButton(
              "btn_view_result",
              "📊 Xem báo cáo chi tiết",
              detailsUrl,
            ),
          ]
        : [];

      await this.sendEphemeral(message, text, components);
    } catch (err) {
      this.logger.error("Error in *ketqua command:", err);
      await this.sendEphemeral(
        message,
        "⚠️ Đã xảy ra lỗi. Vui lòng thử lại sau!",
      );
    }
  }

  private formatResult(
    attempt: {
      id: string;
      topic_title: string;
      submitted_at: string;
      score_result: ScoreResult | null;
    },
    detailsUrl: string,
  ): string {
    if (!attempt.score_result) {
      return (
        `⏳ **Bài thi đang được chấm điểm**\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 Mã bài thi: \`${attempt.id}\`\n` +
        `📋 Chủ đề: ${attempt.topic_title || "N/A"}\n\n` +
        `Vui lòng thử lại sau ít phút!`
      );
    }

    // const s = attempt.score_result;
    const date = attempt.submitted_at
      ? new Date(attempt.submitted_at).toLocaleDateString("vi-VN")
      : "N/A";

    return `📊 **KẾT QUẢ BÀI THI IELTS SPEAKING**
    ━━━━━━━━━━━━━━━━━━━━
    🆔 Mã bài thi: \`${attempt.id}\`
    📅 Ngày thi: ${date}
    📋 Chủ đề: ${attempt.topic_title || "N/A"}
    🎯 Điểm tổng quan: ${Number(attempt.score_result?.overall_band).toFixed(1)}`;
  }

  /** Send ephemeral, fallback to DM */
  private async sendEphemeral(message: any, text: string, components?: any[]) {
    try {
      const clanId = message.clan_id || message.clanId || "";
      const channelId = message.channel_id || message.channelId || "";
      const channel = await this.resolveChannel(channelId, clanId);
      if (channel) {
        await channel.sendEphemeral(
          message.sender_id,
          buildMessageContent(text, components),
        );
        return;
      }
    } catch {
      /* fall through */
    }

    try {
      const user =
        this.client.users.get(message.sender_id) ||
        (await this.client.users.fetch(message.sender_id));
      if (user) await user.sendDM(buildMessageContent(text, components));
    } catch (err) {
      this.logger.error("DM fallback failed:", err);
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

// ─────────────────────────────────────────────
// *lichsu
// ─────────────────────────────────────────────

@Injectable()
export class HistoryHandler implements CommandHandler {
  readonly name = "lichsu";
  readonly defaultAliases = ["history", "recent"];
  readonly description = "Xem lịch sử 10 lần thi gần nhất";

  private readonly logger = new Logger(HistoryHandler.name);

  constructor(
    private readonly webApp: WebAppClientService,
    @Inject(MezonClient) private readonly client: MezonClient,
  ) {}

  async execute(ctx: CommandContext): Promise<void> {
    const { tenant, message } = ctx;

    try {
      const res = await this.webApp.getHistory(tenant, message.sender_id);

      if (!res.success || !res.attempts) {
        const prefix = tenant.parsedConfig.command_prefix || "*";
        await this.sendEphemeral(
          message,
          res.error === "User not found"
            ? `⚠️ Tài khoản chưa có trong hệ thống. Hãy đăng nhập web app trước!`
            : `ℹ️ Bạn chưa có bài thi nào. Gõ \`${prefix}thi\` để bắt đầu!`,
        );
        return;
      }

      if (res.attempts.length === 0) {
        const prefix = tenant.parsedConfig.command_prefix || "*";
        await this.sendEphemeral(
          message,
          `ℹ️ Bạn chưa có bài thi nào. Gõ \`${prefix}thi\` để bắt đầu!`,
        );
        return;
      }

      const prefix = tenant.parsedConfig.command_prefix || "*";
      const emojis = [
        "1. ",
        "2. ",
        "3. ",
        "4. ",
        "5. ",
        "6. ",
        "7. ",
        "8. ",
        "9. ",
        "10. ",
      ];

      let text = `📋 **LỊCH SỬ 10 LẦN THI GẦN NHẤT**\n━━━━━━━━━━━━━━━━━━━━\n\n`;

      for (let i = 0; i < res.attempts.length; i++) {
        const a = res.attempts[i];
        const date = a.submitted_at
          ? new Date(a.submitted_at).toLocaleDateString("vi-VN")
          : "Chưa nộp";
        const score = Number(a.score_result?.overall_band).toFixed(1) ?? "—";
        const emoji = emojis[i] || `${i + 1}.`;
        text += `${emoji} Ngày thi:${date} | Mã bài thi: \`${a.id}\` | Chủ đề: ${a.topic_title || "N/A"} | Điểm tổng quát: **${score}** \n`;
      }

      text +=
        `\n━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 Gõ \`${prefix}ketqua <attempt-id>\` để xem chi tiết`;

      await this.sendEphemeral(message, text);
    } catch (err) {
      this.logger.error("Error in *lichsu command:", err);
      await this.sendEphemeral(
        message,
        "⚠️ Đã xảy ra lỗi. Vui lòng thử lại sau!",
      );
    }
  }

  private async sendEphemeral(message: any, text: string, components?: any[]) {
    try {
      const clanId = message.clan_id || message.clanId || "";
      const channelId = message.channel_id || message.channelId || "";
      const channel = await this.resolveChannel(channelId, clanId);
      if (channel) {
        await channel.sendEphemeral(
          message.sender_id,
          buildMessageContent(text, components),
        );
        return;
      }
    } catch {
      /* fall through */
    }

    try {
      const user =
        this.client.users.get(message.sender_id) ||
        (await this.client.users.fetch(message.sender_id));
      if (user) await user.sendDM(buildMessageContent(text, components));
    } catch (err) {
      this.logger.error("DM fallback failed:", err);
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
