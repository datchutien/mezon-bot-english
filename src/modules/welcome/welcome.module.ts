import { Module } from '@nestjs/common';
import { WelcomeHandler } from './welcome.handler';

@Module({
  providers: [WelcomeHandler],
  exports: [WelcomeHandler],
})
export class WelcomeModule {}
