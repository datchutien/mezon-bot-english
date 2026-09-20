import { Module } from '@nestjs/common';
import { ExamHandler } from './exam.handler';
import { WebAppClientModule } from '../../core/web-app-client/web-app-client.module';

@Module({
  imports: [WebAppClientModule],
  providers: [ExamHandler],
  exports: [ExamHandler],
})
export class ExamModule {}
