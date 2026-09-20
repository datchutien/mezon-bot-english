import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { extractMessageText, parseCommandLineArgs } from '../../shared/text-extract.utils';
import {
  CommandHandler,
  CommandContext,
  TenantWithConfig,
  DEFAULT_TENANT_CONFIG,
} from './interfaces/command-handler.interface';
import { TenantCommand } from '@prisma/client';

@Injectable()
export class CommandRegistryService {
  private readonly logger = new Logger(CommandRegistryService.name);

  /** Map: name/alias → handler */
  private handlers = new Map<string, CommandHandler>();

  /** Cache: tenantId → { commands, expiresAt } */
  private cmdCache = new Map<
    string,
    { commands: TenantCommand[]; expiresAt: number }
  >();
  private readonly CMD_CACHE_TTL_MS = 30_000; // 30 seconds

  constructor(private readonly prisma: PrismaService) {}

  /** Register a command handler by its name and all default aliases */
  registerHandler(handler: CommandHandler): void {
    this.handlers.set(handler.name, handler);
    for (const alias of handler.defaultAliases) {
      this.handlers.set(alias, handler);
    }
    this.logger.log(
      `📝 Registered command: ${handler.name} (aliases: ${handler.defaultAliases.join(', ') || 'none'})`,
    );
  }

  /**
   * Main dispatch: called for every channel message.
   * Resolves the command, checks tenant-level enable/disable, and executes.
   */
  async dispatch(
    tenant: TenantWithConfig,
    message: any,
  ): Promise<void> {
    const prefix = tenant.parsedConfig.command_prefix || '*';
    const text = extractMessageText(message.content);

    if (!text.startsWith(prefix)) return;

    const [rawCmd, ...args] = parseCommandLineArgs(text.slice(prefix.length).trim());
    if (!rawCmd) return;

    const cmdInput = rawCmd.toLowerCase();

    // Load tenant commands (cached)
    const tenantCommands = await this.getTenantCommands(tenant.id);

    // Find which base command this input maps to
    const cmdConfig = this.resolveCommand(cmdInput, tenantCommands);
    if (!cmdConfig || !cmdConfig.enabled) return;

    // Find the handler
    const handler = this.handlers.get(cmdConfig.commandName);
    if (!handler) {
      this.logger.warn(
        `No handler registered for command: ${cmdConfig.commandName}`,
      );
      return;
    }

    // Build context and execute
    const ctx: CommandContext = {
      tenant,
      message,
      args,
      config: (cmdConfig.customConfig as Record<string, any>) || {},
    };

    try {
      await handler.execute(ctx);
    } catch (err) {
      this.logger.error(
        `Error executing command "${cmdConfig.commandName}" for tenant "${tenant.name}":`,
        err,
      );
    }
  }

  /**
   * Dispatches commands for an unregistered clan (e.g. *admin register, *admin help).
   */
  async dispatchUnregistered(
    clanId: string,
    message: any,
    text: string,
  ): Promise<void> {
    const parts = parseCommandLineArgs(text.slice(1).trim());
    const cmdName = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    if (cmdName === 'admin') {
      const handler = this.handlers.get('admin');
      if (!handler) {
        this.logger.warn('Admin handler not registered');
        return;
      }

      const pendingTenant: TenantWithConfig = {
        id: '',
        clanId,
        name: 'Chưa đăng ký',
        webAppUrl: '',
        webAppApiSecret: '',
        botVerifySecret: '',
        config: {},
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        parsedConfig: DEFAULT_TENANT_CONFIG,
      };

      const ctx: CommandContext = {
        tenant: pendingTenant,
        message,
        args,
        config: {},
      };

      try {
        await handler.execute(ctx);
      } catch (err) {
        this.logger.error(`Error executing unregistered command for clan "${clanId}":`, err);
      }
    }
  }

  /** Enable or disable a command for a tenant */
  async setCommandEnabled(
    tenantId: string,
    commandName: string,
    enabled: boolean,
  ): Promise<void> {
    await this.prisma.tenantCommand.upsert({
      where: {
        tenantId_commandName: { tenantId, commandName },
      },
      update: { enabled },
      create: {
        tenantId,
        commandName,
        enabled,
        customAliases: [],
        customConfig: {},
      },
    });
    this.cmdCache.delete(tenantId);
  }

  /** Update custom config for a command */
  async updateCommandConfig(
    tenantId: string,
    commandName: string,
    customConfig: Record<string, any>,
  ): Promise<void> {
    await this.prisma.tenantCommand.upsert({
      where: {
        tenantId_commandName: { tenantId, commandName },
      },
      update: { customConfig: customConfig as any },
      create: {
        tenantId,
        commandName,
        enabled: true,
        customAliases: [],
        customConfig: customConfig as any,
      },
    });
    this.cmdCache.delete(tenantId);
  }

  /** Get all tenant commands (cached 30s) */
  private async getTenantCommands(
    tenantId: string,
  ): Promise<TenantCommand[]> {
    const cached = this.cmdCache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.commands;
    }

    const commands = await this.prisma.tenantCommand.findMany({
      where: { tenantId },
    });

    this.cmdCache.set(tenantId, {
      commands,
      expiresAt: Date.now() + this.CMD_CACHE_TTL_MS,
    });
    return commands;
  }

  /**
   * Resolve user input to a TenantCommand.
   * Checks: base command name match, default aliases, custom aliases.
   */
  private resolveCommand(
    input: string,
    tenantCommands: TenantCommand[],
  ): TenantCommand | null {
    // 1. Direct match on command name
    const direct = tenantCommands.find((c) => c.commandName === input);
    if (direct) return direct;

    // 2. Check custom aliases per tenant
    for (const cmd of tenantCommands) {
      if (cmd.customAliases.includes(input)) return cmd;
    }

    // 3. Check default aliases from registered handlers
    const handler = this.handlers.get(input);
    if (handler) {
      const byName = tenantCommands.find(
        (c) => c.commandName === handler.name,
      );
      if (byName) return byName;
    }

    return null;
  }
}
