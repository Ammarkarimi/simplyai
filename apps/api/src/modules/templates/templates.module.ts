import { Module } from '@nestjs/common';
import { TemplatesController } from './templates.controller';
import { WorkflowsModule } from '../workflows/workflows.module';

@Module({ imports: [WorkflowsModule], controllers: [TemplatesController] })
export class TemplatesModule {}
