import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NezonModule } from '@n0xgg04/nezon';
import { DatabaseModule } from './core/database/database.module';
import { TenantModule } from './core/tenant/tenant.module';
import { CommandRegistryModule } from './core/command-registry/command-registry.module';
import { CommandRegistryService } from './core/command-registry/command-registry.service';
import { WebAppClientModule } from './core/web-app-client/web-app-client.module';
import { BotApiModule } from './core/bot-api/bot-api.module';
import { WelcomeModule } from './modules/welcome/welcome.module';
import { ExamModule } from './modules/exam/exam.module';
import { ExamHandler } from './modules/exam/exam.handler';
import { ResultModule } from './modules/result/result.module';
import { ResultHandler, HistoryHandler } from './modules/result/result.handler';
import { AdminModule } from './modules/admin/admin.module';
import { AdminHandler } from './modules/admin/admin.handler';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    NezonModule.forRoot({
      token: process.env.MEZON_TOKEN ?? '',
      botId: process.env.MEZON_BOT_ID ?? '',
    }),

    // Core
    DatabaseModule,
    TenantModule,
    CommandRegistryModule,
    WebAppClientModule,
    BotApiModule,

    // Feature modules
    WelcomeModule,
    ExamModule,
    ResultModule,
    AdminModule,
  ],
})
export class AppModule implements OnModuleInit {
  constructor(
    private readonly commandRegistry: CommandRegistryService,
    private readonly examHandler: ExamHandler,
    private readonly resultHandler: ResultHandler,
    private readonly historyHandler: HistoryHandler,
    private readonly adminHandler: AdminHandler,
  ) {}

  /**
   * Register all command handlers with the dynamic command registry.
   * This runs after all modules are initialized.
   */
  onModuleInit() {
    this.commandRegistry.registerHandler(this.examHandler);
    this.commandRegistry.registerHandler(this.resultHandler);
    this.commandRegistry.registerHandler(this.historyHandler);
    this.commandRegistry.registerHandler(this.adminHandler);

    console.log('✅ [AppModule] All command handlers registered');
  }
}
