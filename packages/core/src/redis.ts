import Redis, { type RedisOptions } from 'ioredis';
import { env } from './env';

export function createRedis(opts: RedisOptions = {}): Redis {
  return new Redis(env.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true, ...opts });
}

export function redisConnectionOptions(): RedisOptions {
  const u = new URL(env.redisUrl);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}
