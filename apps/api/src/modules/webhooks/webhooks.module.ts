import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { PublicController } from './public.controller';
import { WebhooksService } from './webhooks.service';

@Module({ controllers: [WebhooksController, PublicController], providers: [WebhooksService], exports: [WebhooksService] })
export class WebhooksModule {}
