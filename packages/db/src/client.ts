import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { __simplyaiPrisma?: PrismaClient };

export function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.PRISMA_LOG === 'query' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

/** Process-wide singleton */
export const prisma: PrismaClient = globalForPrisma.__simplyaiPrisma ?? createPrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.__simplyaiPrisma = prisma;
