import { Module } from '@nestjs/common';
import { CommandRegistryService } from './command-registry.service';
import { BotGateway } from './bot.gateway';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [TenantModule],
  providers: [CommandRegistryService, BotGateway],
  exports: [CommandRegistryService],
})
export class CommandRegistryModule {}
