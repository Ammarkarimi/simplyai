import { Module } from '@nestjs/common';
import { DataTablesController } from './datatables.controller';

@Module({ controllers: [DataTablesController] })
export class DataTablesModule {}
