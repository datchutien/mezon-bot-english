import { Tenant } from '@prisma/client';

/** Parsed shape of Tenant.config JSON field */
export interface TenantConfig {
  command_prefix: string;
  language: 'vi' | 'en' | 'bilingual';
  welcome_message?: string;
  admin_ids?: string[];
}

/** Tenant with parsed config for convenience */
export type TenantWithConfig = Tenant & { parsedConfig: TenantConfig };

/** Context passed to every command handler */
export interface CommandContext {
  tenant: TenantWithConfig;
  message: any; // Mezon channel message event
  args: string[];
  config: Record<string, any>; // Per-tenant custom config from tenant_commands.customConfig
}

/** Interface every command module must implement */
export interface CommandHandler {
  /** Base command name, e.g. 'ketqua' */
  name: string;
  /** Default aliases, e.g. ['result', 'kq', 'score'] */
  defaultAliases: string[];
  /** Human-readable description */
  description: string;
  /** Execute the command with the given context */
  execute(ctx: CommandContext): Promise<void>;
}

/** Default config values for new tenants */
export const DEFAULT_TENANT_CONFIG: TenantConfig = {
  command_prefix: '*',
  language: 'vi',
  admin_ids: [],
};

/** Built-in commands that get seeded for every new tenant */
export const BUILT_IN_COMMANDS = ['thi', 'ketqua', 'lichsu', 'admin'] as const;
