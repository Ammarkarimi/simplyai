import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { prisma, type PrismaClient } from '@simplyai/db';

/** Thin injectable wrapper so services receive the shared Prisma client. */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly db: PrismaClient = prisma;
  async onModuleDestroy() {
    await this.db.$disconnect();
  }
}
