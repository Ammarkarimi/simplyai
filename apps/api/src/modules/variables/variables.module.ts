import { Module } from '@nestjs/common';
import { VariablesController } from './variables.controller';

@Module({ controllers: [VariablesController] })
export class VariablesModule {}
