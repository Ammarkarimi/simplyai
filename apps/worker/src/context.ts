import { prisma } from '@simplyai/db';
import { createQueues, createRedis } from '@simplyai/core';
import { EVENTS_CHANNEL, type RealtimeEvent } from '@simplyai/shared';

export const db = prisma;
export const queues = createQueues();
export const redis = createRedis();

export async function publish(e: RealtimeEvent): Promise<void> {
  await redis.publish(EVENTS_CHANNEL, JSON.stringify(e)).catch(() => undefined);
}

export const log = {
  info: (msg: string, ctx?: Record<string, unknown>) => console.log(JSON.stringify({ level: 'info', time: new Date().toISOString(), msg, ...ctx })),
  warn: (msg: string, ctx?: Record<string, unknown>) => console.warn(JSON.stringify({ level: 'warn', time: new Date().toISOString(), msg, ...ctx })),
  error: (msg: string, ctx?: Record<string, unknown>) => console.error(JSON.stringify({ level: 'error', time: new Date().toISOString(), msg, ...ctx })),
  debug: (msg: string, ctx?: Record<string, unknown>) => {
    if (process.env.LOG_LEVEL === 'debug') console.log(JSON.stringify({ level: 'debug', time: new Date().toISOString(), msg, ...ctx }));
  },
};
