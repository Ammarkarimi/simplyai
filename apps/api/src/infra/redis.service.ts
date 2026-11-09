import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createRedis } from '@simplyai/core';
import type Redis from 'ioredis';
import { CANCEL_CHANNEL, EVENTS_CHANNEL, type RealtimeEvent } from '@simplyai/shared';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis = createRedis();

  async publishEvent(e: RealtimeEvent) {
    await this.client.publish(EVENTS_CHANNEL, JSON.stringify(e));
  }

  async requestCancel(executionId: string) {
    await this.client.set(`sai:cancel:${executionId}`, '1', 'EX', 3600);
    await this.client.publish(CANCEL_CHANNEL, executionId);
  }

  /** Fixed window counter. Returns true when within the limit. */
  async rateLimit(key: string, limit: number, windowSec: number): Promise<{ ok: boolean; remaining: number; reset: number }> {
    const bucket = Math.floor(Date.now() / 1000 / windowSec);
    const k = `sai:rl:${key}:${bucket}`;
    const count = await this.client.incr(k);
    if (count === 1) await this.client.expire(k, windowSec + 1);
    return { ok: count <= limit, remaining: Math.max(0, limit - count), reset: (bucket + 1) * windowSec };
  }

  async onModuleDestroy() {
    this.client.disconnect();
  }
}
