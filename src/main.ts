import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  app.enableCors({
    origin: frontendUrl,
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // Serve uploaded files — UPLOAD_BASE_DIR is set to the Railway volume path in prod
  const uploadBase = process.env.UPLOAD_BASE_DIR
    ? process.env.UPLOAD_BASE_DIR
    : join(process.cwd(), 'uploads');
  app.useStaticAssets(uploadBase, { prefix: '/uploads' });

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
