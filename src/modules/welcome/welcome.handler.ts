import { Injectable, Logger } from '@nestjs/common';
import { TenantWithConfig } from '../../core/command-registry/interfaces/command-handler.interface';

/**
 * Welcome handler — NOT a CommandHandler (event-driven, not command-driven).
 * Called by BotGateway when onAddClanUser fires.
 */
@Injectable()
export class WelcomeHandler {
  private readonly logger = new Logger(WelcomeHandler.name);

  /** Build welcome message using tenant config */
  buildWelcomeMessage(tenant: TenantWithConfig, username: string): string {
    if (tenant.parsedConfig.welcome_message) {
      return tenant.parsedConfig.welcome_message;
    }

    const p = tenant.parsedConfig.command_prefix || '*';

    return (
      `🎉 **Chào mừng @${username} đến với ${tenant.name}!**\n\n` +
      `• Gõ \`${p}thi\` để bắt đầu bài thi ngay\n` +
      `• Gõ \`${p}ketqua\` để xem kết quả bài thi\n` +
      `• Gõ \`${p}lichsu\` để xem lịch sử các lần thi`
    );
  }
}
