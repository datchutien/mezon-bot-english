import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import {
  TenantConfig,
  TenantWithConfig,
  DEFAULT_TENANT_CONFIG,
  BUILT_IN_COMMANDS,
} from "../command-registry/interfaces/command-handler.interface";
import { Tenant } from "@prisma/client";

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  /** In-memory cache: clan_id → { tenant, expiresAt } */
  private cacheByClаn = new Map<
    string,
    { tenant: TenantWithConfig; expiresAt: number }
  >();
  /** In-memory cache: bot_verify_secret → tenant */
  private cacheBySecret = new Map<string, TenantWithConfig>();

  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly prisma: PrismaService) {}

  /** Parse the JSON config field into TenantConfig with defaults */
  private parseConfig(tenant: Tenant): TenantWithConfig {
    const raw = (tenant.config as Record<string, any>) || {};
    const parsedConfig: TenantConfig = {
      command_prefix:
        raw.command_prefix || DEFAULT_TENANT_CONFIG.command_prefix,
      language: raw.language || DEFAULT_TENANT_CONFIG.language,
      welcome_message: raw.welcome_message,
      admin_ids: Array.isArray(raw.admin_ids) ? raw.admin_ids : [],
    };
    return { ...tenant, parsedConfig };
  }

  /** Resolve a Mezon clan_id to a Tenant (cached 5 min) */
  async resolveByClanId(clanId: string): Promise<TenantWithConfig | null> {
    const cached = this.cacheByClаn.get(clanId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.tenant;
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { clanId },
    });

    if (!tenant || !tenant.isActive) return null;

    const parsed = this.parseConfig(tenant);
    this.cacheByClаn.set(clanId, {
      tenant: parsed,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });
    return parsed;
  }

  /** Resolve a bot_verify_secret to a Tenant (for web app → bot auth) */
  async findByBotVerifySecret(
    secret: string,
  ): Promise<TenantWithConfig | null> {
    const cached = this.cacheBySecret.get(secret);
    if (cached) return cached;

    const tenant = await this.prisma.tenant.findFirst({
      where: { botVerifySecret: secret, isActive: true },
    });

    if (!tenant) return null;

    const parsed = this.parseConfig(tenant);
    this.cacheBySecret.set(secret, parsed);
    return parsed;
  }

  /** Create a new tenant and seed default commands */
  async createTenant(data: {
    clanId: string;
    name: string;
    webAppUrl: string;
    webAppApiSecret: string;
    botVerifySecret: string;
    config?: Partial<TenantConfig>;
  }): Promise<TenantWithConfig> {
    const config = { ...DEFAULT_TENANT_CONFIG, ...data.config };

    const tenant = await this.prisma.tenant.create({
      data: {
        clanId: data.clanId,
        name: data.name,
        webAppUrl: this.normalizeUrl(data.webAppUrl),
        webAppApiSecret: data.webAppApiSecret,
        botVerifySecret: data.botVerifySecret,
        config: config as any,
      },
    });

    // Seed built-in commands (all enabled by default)
    for (const cmd of BUILT_IN_COMMANDS) {
      await this.prisma.tenantCommand.create({
        data: {
          tenantId: tenant.id,
          commandName: cmd,
          enabled: true,
          customAliases: [],
          customConfig: {},
        },
      });
    }

    this.logger.log(`✅ Created tenant "${data.name}" for clan ${data.clanId}`);
    this.invalidateCache(data.clanId);
    return this.parseConfig(tenant);
  }

  /** Update tenant config JSON */
  async updateTenantConfig(
    tenantId: string,
    config: Partial<TenantConfig>,
  ): Promise<TenantWithConfig> {
    const existing = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
    });
    const currentConfig = (existing.config as Record<string, any>) || {};
    const merged = { ...currentConfig, ...config };

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { config: merged as any },
    });

    this.invalidateCache(updated.clanId);
    return this.parseConfig(updated);
  }

  /** Update tenant details (name, webAppUrl, secrets) */
  async updateTenantDetails(
    tenantId: string,
    data: {
      name?: string;
      webAppUrl?: string;
      webAppApiSecret?: string;
      botVerifySecret?: string;
    },
  ): Promise<TenantWithConfig> {
    const webAppUrl = data.webAppUrl ? this.normalizeUrl(data.webAppUrl) : undefined;
    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(webAppUrl ? { webAppUrl } : {}),
        ...(data.webAppApiSecret ? { webAppApiSecret: data.webAppApiSecret } : {}),
        ...(data.botVerifySecret ? { botVerifySecret: data.botVerifySecret } : {}),
      },
    });

    this.invalidateCache(updated.clanId);
    return this.parseConfig(updated);
  }

  private normalizeUrl(url: string): string {
    let trimmed = url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(trimmed)) {
      trimmed = `http://${trimmed}`;
    }
    return trimmed;
  }

  /** Clear cache for a specific clan */
  invalidateCache(clanId: string) {
    this.cacheByClаn.delete(clanId);
    // Also clear secret cache since config may have changed
    this.cacheBySecret.clear();
  }
}
