import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const additionalOrigins = (process.env.ADDITIONAL_CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: [frontendUrl, ...additionalOrigins],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (process.env.SWAGGER_ENABLED === 'true') {
    // ponytail: version hardcoded, not read from package.json at runtime — dist/src/main.js
    // vs source-level src/main.ts have different relative depths to package.json (render.yaml's
    // startCommand is `node dist/src/main.js`, and nest-cli has no assets copy step for
    // package.json), so require('../package.json') would 404 in production. Bump this string
    // by hand when package.json's "version" changes.
    const config = new DocumentBuilder()
      .setTitle('Inflique API')
      .setDescription('Inflique backend API documentation')
      .setVersion('0.0.1')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'jwt')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  // Uploaded files now live in Supabase Storage (see StorageService) — public
  // objects have absolute URLs, private ones are served via signed URLs. No local
  // static mount remains.
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
