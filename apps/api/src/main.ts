import 'reflect-metadata';
import '@simplyai/core';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { env, getRegistry } from '@simplyai/core';
import { AppModule } from './app.module';
import { WebhooksService } from './modules/webhooks/webhooks.service';

export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, bodyParser: true, logger: ['error', 'warn', 'log'] });
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '5mb' });
  app.useBodyParser('urlencoded', { limit: '5mb', extended: true });
  app.enableCors({ origin: env.appUrl.split(','), credentials: true });
  const webhooks = app.get(WebhooksService);
  app.use('/webhook', webhooks.router());
  app.use('/webhook-test', webhooks.router());
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  getRegistry();
  return app;
}

async function bootstrap() {
  const app = await createApp();
  await app.listen(env.apiPort, '0.0.0.0');
  Logger.log(`SimplyAI API listening on :${env.apiPort} (${getRegistry().listNodes().length} nodes registered)`, 'Bootstrap');
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
