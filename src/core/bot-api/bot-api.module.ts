import { Module } from '@nestjs/common';
import { BotApiController } from './bot-api.controller';
import { TenantModule } from '../tenant/tenant.module';
import { WebAppClientModule } from '../web-app-client/web-app-client.module';

@Module({
  imports: [TenantModule, WebAppClientModule],
  controllers: [BotApiController],
})
export class BotApiModule {}
