import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.BOT_HTTP_PORT || 3100;
  await app.listen(port);

  console.log(`🌐 [Bot API] HTTP server listening on :${port}`);
  console.log(`🤖 [Bot] Mezon English Bot is running...`);
}
bootstrap();
