import { Module } from '@nestjs/common';
import { WebAppClientService } from './web-app-client.service';

@Module({
  providers: [WebAppClientService],
  exports: [WebAppClientService],
})
export class WebAppClientModule {}
