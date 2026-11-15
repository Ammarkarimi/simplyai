import { Module } from '@nestjs/common';
import { AppsController } from './apps.controller';
import { AppsRuntimeController } from './apps-runtime.controller';
import { AppsService } from './apps.service';

@Module({ controllers: [AppsController, AppsRuntimeController], providers: [AppsService] })
export class AppsModule {}
