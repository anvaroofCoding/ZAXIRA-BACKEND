import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import compression from 'compression';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { createValidationPipe } from './common/pipes/validation.pipe';
import { isSerpApiConfigured, loadBackendEnvFiles } from './config/load-env';

loadBackendEnvFiles();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port', 8000);
  const apiPrefix = configService.get<string>('apiPrefix', 'api');
  const corsOrigin = configService.get<string>(
    'corsOrigin',
    'http://localhost:5173',
  );
  const corsOrigins = corsOrigin
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(compression());
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));
  app.setGlobalPrefix(apiPrefix);
  app.enableShutdownHooks();
  app.enableCors({
    // LAN/dev rejimida frontend originlarini avtomatik qabul qiladi.
    origin: true,
    credentials: true,
  });

  app.useGlobalPipes(createValidationPipe());

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));

  await app.listen(port, '0.0.0.0');

  const serpFromConfig = configService.get<string>('serpApi.apiKey')?.trim();
  const serpEnabled = Boolean(serpFromConfig || isSerpApiConfigured());

  console.log(`ZAXIRA API: http://localhost:${port}/${apiPrefix}`);

  console.log(`ZAXIRA Realtime: ws://localhost:${port}/realtime`);

  console.log(
    serpEnabled
      ? 'Internetdan narx qidirish: yoqilgan (SerpAPI)'
      : 'Internetdan narx qidirish: o‘chirilgan — ZAXIRA-BACKEND/.env da SERPAPI_API_KEY qo‘ying',
  );
}

void bootstrap();
