import { Module } from '@nestjs/common';
import { ResultHandler, HistoryHandler } from './result.handler';
import { WebAppClientModule } from '../../core/web-app-client/web-app-client.module';

@Module({
  imports: [WebAppClientModule],
  providers: [ResultHandler, HistoryHandler],
  exports: [ResultHandler, HistoryHandler],
})
export class ResultModule {}
