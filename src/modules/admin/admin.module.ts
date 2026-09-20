import { Module } from '@nestjs/common';
import { AdminHandler } from './admin.handler';
import { TenantModule } from '../../core/tenant/tenant.module';
import { CommandRegistryModule } from '../../core/command-registry/command-registry.module';

@Module({
  imports: [TenantModule, CommandRegistryModule],
  providers: [AdminHandler],
  exports: [AdminHandler],
})
export class AdminModule {}
