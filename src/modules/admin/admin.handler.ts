import { Injectable, Logger, Inject } from '@nestjs/common';
import { MezonClient } from 'mezon-sdk';
import {
  CommandHandler,
  CommandContext,
  BUILT_IN_COMMANDS,
} from '../../core/command-registry/interfaces/command-handler.interface';
import { TenantService } from '../../core/tenant/tenant.service';
import { CommandRegistryService } from '../../core/command-registry/command-registry.service';
import { PrismaService } from '../../core/database/prisma.service';
import { buildMessageContent } from '../../shared/message.utils';

/**
 * *admin — Manage tenant configuration with 2-tier permissions:
 * - Super Admin: Defined in SUPER_ADMIN_IDS (.env) for technicians / setup staff.
 * - Tenant Admin: Stored in tenant.config.admin_ids for center owners / managers.
 *
 * Subcommands:
 *   *admin register <name> <web_app_url> <api_secret> <bot_secret> [@mention_or_id]
 *   *admin addadmin <@mention_or_id>
 *   *admin removeadmin <@mention_or_id>
 *   *admin enable <command>
 *   *admin disable <command>
 *   *admin prefix <new_prefix>
 *   *admin welcome <message>
 *   *admin status
 *   *admin help
 */
@Injectable()
export class AdminHandler implements CommandHandler {
  readonly name = 'admin';
  readonly defaultAliases: string[] = [];
  readonly description = 'Quản lý cấu hình trung tâm';

  private readonly logger = new Logger(AdminHandler.name);

  constructor(
    private readonly tenantService: TenantService,
    private readonly commandRegistry: CommandRegistryService,
    private readonly prisma: PrismaService,
    @Inject(MezonClient) private readonly client: MezonClient,
  ) {}

  async execute(ctx: CommandContext): Promise<void> {
    const { tenant, message, args } = ctx;
    const sub = (args[0] || 'help').toLowerCase();

    // Check permission for commands other than help and register
    // (register handles its own permission checks internally)
    if (sub !== 'help' && sub !== 'register') {
      if (!this.isTenantAdmin(tenant, message.sender_id)) {
        await this.sendEphemeral(
          message,
          '⛔ Bạn không có quyền thực hiện lệnh quản trị của trung tâm này.',
        );
        return;
      }
    }

    try {
      switch (sub) {
        case 'register':
          await this.handleRegister(message, args.slice(1));
          break;
        case 'addadmin':
          await this.handleAddAdmin(tenant, message, args.slice(1));
          break;
        case 'removeadmin':
          await this.handleRemoveAdmin(tenant, message, args.slice(1));
          break;
        case 'enable':
          await this.handleToggle(tenant, message, args[1], true);
          break;
        case 'disable':
          await this.handleToggle(tenant, message, args[1], false);
          break;
        case 'prefix':
          await this.handlePrefix(tenant, message, args[1]);
          break;
        case 'welcome':
          await this.handleWelcome(tenant, message, args.slice(1).join(' '));
          break;
        case 'status':
          await this.handleStatus(tenant, message);
          break;
        case 'help':
        default:
          await this.handleHelp(tenant, message);
          break;
      }
    } catch (err) {
      this.logger.error('Error in *admin command:', err);
      await this.sendEphemeral(message, '⚠️ Đã xảy ra lỗi khi xử lý lệnh admin.');
    }
  }

  /** Check if sender is a Super Admin (IT / setup staff from .env) */
  private isSuperAdmin(senderId: string): boolean {
    const raw = process.env.SUPER_ADMIN_IDS || process.env.BOT_ADMIN_IDS || '';
    const superAdmins = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return superAdmins.includes(senderId);
  }

  /** Check if sender is allowed to manage this tenant */
  private isTenantAdmin(
    tenant: CommandContext['tenant'],
    senderId: string,
  ): boolean {
    if (this.isSuperAdmin(senderId)) return true;

    const adminIds = tenant?.parsedConfig?.admin_ids || [];
    if (adminIds.length > 0) {
      return adminIds.includes(senderId);
    }

    // If no tenant admins set yet, check if SUPER_ADMIN_IDS exists
    const superAdmins = (process.env.SUPER_ADMIN_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // If SUPER_ADMIN_IDS configured, only super admins can manage unclaimed tenant
    if (superAdmins.length > 0) {
      return false;
    }

    // Dev fallback if no admin configuration exists at all
    return true;
  }

  /** Helper to extract target user id from mentions or string arg */
  private extractTargetUser(message: any, rawInput?: string): string | null {
    if (Array.isArray(message?.mentions) && message.mentions.length > 0) {
      const botId = process.env.MEZON_BOT_ID || (this.client as any).clientId;
      const userMention = message.mentions.find(
        (m: any) => m.user_id && m.user_id !== botId,
      );
      if (userMention?.user_id) {
        return userMention.user_id;
      }
    }

    if (rawInput) {
      const cleaned = rawInput.replace(/[<@!>]/g, '').trim();
      if (cleaned) {
        return cleaned;
      }
    }

    return null;
  }

  private async handleRegister(message: any, args: string[]) {
    if (args.length < 4) {
      await this.sendEphemeral(
        message,
        `⚠️ Cú pháp: \`*admin register <tên TT> <web_app_url> <api_secret> <bot_secret> [@mention_chu_trung_tam]\``,
      );
      return;
    }

    const clanId = message.clan_id || message.clanId;
    if (!clanId) {
      await this.sendEphemeral(message, '⚠️ Không xác định được clan.');
      return;
    }

    // Check if clan already registered
    const existing = await this.tenantService.resolveByClanId(clanId);

    if (existing) {
      if (!this.isTenantAdmin(existing, message.sender_id)) {
        await this.sendEphemeral(
          message,
          '⛔ Bạn không có quyền cập nhật cấu hình trung tâm này.',
        );
        return;
      }
    } else {
      const superAdmins = (process.env.SUPER_ADMIN_IDS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (superAdmins.length > 0 && !this.isSuperAdmin(message.sender_id)) {
        await this.sendEphemeral(
          message,
          '⛔ Chỉ nhân viên kỹ thuật (Super Admin) mới có quyền đăng ký trung tâm mới.',
        );
        return;
      }
    }

    const [name, webAppUrl, apiSecret, botSecret] = args;
    // 5th argument or mention: target admin (end-user / clan owner)
    const designatedAdmin =
      this.extractTargetUser(message, args[4]) || message.sender_id;

    if (existing) {
      const currentAdminIds = existing.parsedConfig.admin_ids || [];
      const newAdminIds = currentAdminIds.includes(designatedAdmin)
        ? currentAdminIds
        : [...currentAdminIds, designatedAdmin];

      const updated = await this.tenantService.updateTenantDetails(existing.id, {
        name,
        webAppUrl,
        webAppApiSecret: apiSecret,
        botVerifySecret: botSecret,
      });

      await this.tenantService.updateTenantConfig(existing.id, {
        admin_ids: newAdminIds,
      });

      await this.sendEphemeral(
        message,
        `🔄 **Cập nhật cấu hình trung tâm thành công!**\n` +
          `• Tên: **${updated.name}**\n` +
          `• Web App: \`${updated.webAppUrl}\`\n` +
          `• Quản trị viên (Admin ID): ${newAdminIds.map((id) => `\`${id}\``).join(', ')}\n` +
          `• Commands đã bật: ${BUILT_IN_COMMANDS.join(', ')}`,
      );
      return;
    }

    const tenant = await this.tenantService.createTenant({
      clanId,
      name,
      webAppUrl,
      webAppApiSecret: apiSecret,
      botVerifySecret: botSecret,
      config: {
        admin_ids: [designatedAdmin],
      },
    });

    await this.sendEphemeral(
      message,
      `✅ **Đăng ký thành công!**\n` +
        `• Tên: **${tenant.name}**\n` +
        `• Web App: \`${tenant.webAppUrl}\`\n` +
        `• Quản trị viên (Admin ID): \`${designatedAdmin}\`\n` +
        `• Commands đã bật: ${BUILT_IN_COMMANDS.join(', ')}`,
    );
  }

  private async handleAddAdmin(
    tenant: CommandContext['tenant'],
    message: any,
    args: string[],
  ) {
    const targetId = this.extractTargetUser(message, args[0]);
    if (!targetId) {
      await this.sendEphemeral(
        message,
        `⚠️ Cú pháp: \`*admin addadmin <@mention hoặc user_id>\``,
      );
      return;
    }

    const currentAdmins = tenant.parsedConfig.admin_ids || [];
    if (currentAdmins.includes(targetId)) {
      await this.sendEphemeral(
        message,
        `ℹ️ User \`${targetId}\` đã là quản trị viên của trung tâm.`,
      );
      return;
    }

    const newAdmins = [...currentAdmins, targetId];
    await this.tenantService.updateTenantConfig(tenant.id, {
      admin_ids: newAdmins,
    });

    await this.sendEphemeral(
      message,
      `✅ Đã thêm quản trị viên mới: \`${targetId}\``,
    );
  }

  private async handleRemoveAdmin(
    tenant: CommandContext['tenant'],
    message: any,
    args: string[],
  ) {
    const targetId = this.extractTargetUser(message, args[0]);
    if (!targetId) {
      await this.sendEphemeral(
        message,
        `⚠️ Cú pháp: \`*admin removeadmin <@mention hoặc user_id>\``,
      );
      return;
    }

    const currentAdmins = tenant.parsedConfig.admin_ids || [];
    if (!currentAdmins.includes(targetId)) {
      await this.sendEphemeral(
        message,
        `ℹ️ User \`${targetId}\` không nằm trong danh sách quản trị viên.`,
      );
      return;
    }

    const newAdmins = currentAdmins.filter((id) => id !== targetId);
    await this.tenantService.updateTenantConfig(tenant.id, {
      admin_ids: newAdmins,
    });

    await this.sendEphemeral(
      message,
      `✅ Đã gỡ quyền quản trị của: \`${targetId}\``,
    );
  }

  private async handleToggle(
    tenant: CommandContext['tenant'],
    message: any,
    commandName: string | undefined,
    enabled: boolean,
  ) {
    if (!commandName) {
      await this.sendEphemeral(
        message,
        `⚠️ Cú pháp: \`*admin ${enabled ? 'enable' : 'disable'} <command>\``,
      );
      return;
    }

    await this.commandRegistry.setCommandEnabled(
      tenant.id,
      commandName.toLowerCase(),
      enabled,
    );

    await this.sendEphemeral(
      message,
      `✅ Command \`${commandName}\` đã được ${enabled ? '**bật**' : '**tắt**'}`,
    );
  }

  private async handlePrefix(
    tenant: CommandContext['tenant'],
    message: any,
    newPrefix: string | undefined,
  ) {
    if (!newPrefix) {
      await this.sendEphemeral(message, `⚠️ Cú pháp: \`*admin prefix <ký tự>\``);
      return;
    }

    await this.tenantService.updateTenantConfig(tenant.id, {
      command_prefix: newPrefix,
    });

    await this.sendEphemeral(
      message,
      `✅ Prefix đã đổi thành \`${newPrefix}\`\nVí dụ: \`${newPrefix}thi\`, \`${newPrefix}ketqua\``,
    );
  }

  private async handleWelcome(
    tenant: CommandContext['tenant'],
    message: any,
    welcomeMsg: string,
  ) {
    if (!welcomeMsg.trim()) {
      await this.sendEphemeral(message, `⚠️ Cú pháp: \`*admin welcome <nội dung>\``);
      return;
    }

    await this.tenantService.updateTenantConfig(tenant.id, {
      welcome_message: welcomeMsg,
    });

    await this.sendEphemeral(
      message,
      `✅ Welcome message đã cập nhật:\n\n${welcomeMsg}`,
    );
  }

  private async handleStatus(tenant: CommandContext['tenant'], message: any) {
    const commands = await this.getEnabledCommands(tenant.id);
    const adminList =
      tenant.parsedConfig.admin_ids && tenant.parsedConfig.admin_ids.length > 0
        ? tenant.parsedConfig.admin_ids.map((id) => `\`${id}\``).join(', ')
        : 'Chưa cấu hình (Toàn quyền)';

    const text =
      `📊 **TRẠNG THÁI TRUNG TÂM**\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `• Tên: **${tenant.name}**\n` +
      `• Clan ID: \`${tenant.clanId}\`\n` +
      `• Web App: ${tenant.webAppUrl}\n` +
      `• Prefix: \`${tenant.parsedConfig.command_prefix}\`\n` +
      `• Ngôn ngữ: ${tenant.parsedConfig.language}\n` +
      `• Quản trị viên: ${adminList}\n\n` +
      `**Commands:**\n` +
      commands
        .map((c) => `  ${c.enabled ? '✅' : '❌'} \`${c.commandName}\``)
        .join('\n') +
      `\n━━━━━━━━━━━━━━━━━━━━`;

    await this.sendEphemeral(message, text);
  }

  private async handleHelp(tenant: CommandContext['tenant'], message: any) {
    const p = tenant?.parsedConfig?.command_prefix || '*';

    const text =
      `🤖 **ADMIN COMMANDS**\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `• \`${p}admin register <tên> <url> <api_sec> <bot_sec> [@user]\` — Đăng ký trung tâm & gán admin\n` +
      `• \`${p}admin addadmin <@user hoặc id>\` — Thêm quản trị viên\n` +
      `• \`${p}admin removeadmin <@user hoặc id>\` — Gỡ quản trị viên\n` +
      `• \`${p}admin enable <cmd>\` — Bật command\n` +
      `• \`${p}admin disable <cmd>\` — Tắt command\n` +
      `• \`${p}admin prefix <ký tự>\` — Đổi prefix\n` +
      `• \`${p}admin welcome <nội dung>\` — Đổi welcome message\n` +
      `• \`${p}admin status\` — Xem cấu hình hiện tại\n` +
      `━━━━━━━━━━━━━━━━━━━━`;

    await this.sendEphemeral(message, text);
  }

  private async getEnabledCommands(tenantId: string) {
    return this.prisma.tenantCommand.findMany({
      where: { tenantId },
      orderBy: { commandName: 'asc' },
    });
  }

  private async sendEphemeral(message: any, text: string, components?: any[]) {
    try {
      const clanId = message.clan_id || message.clanId || '';
      const channelId = message.channel_id || message.channelId || '';
      const channel = await this.resolveChannel(channelId, clanId);
      if (channel) {
        await channel.sendEphemeral(message.sender_id, buildMessageContent(text, components));
        return;
      }
    } catch { /* fall through */ }

    try {
      const user = this.client.users.get(message.sender_id) || (await this.client.users.fetch(message.sender_id));
      if (user) await user.sendDM(buildMessageContent(text, components));
    } catch (err) {
      this.logger.error('DM fallback failed:', err);
    }
  }

  private async resolveChannel(channelId: string, clanId: string) {
    if (clanId) {
      const clan = this.client.clans.get(clanId);
      if (clan) { await clan.loadChannels(); return clan.channels.get(channelId) || null; }
    }
    try { return this.client.channels.get(channelId) || (await this.client.channels.fetch(channelId)); }
    catch { return null; }
  }
}
