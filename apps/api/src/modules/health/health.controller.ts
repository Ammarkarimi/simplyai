import { Controller, Get } from '@nestjs/common';
import { Public, RequirePermission, Ws } from '../../common/decorators';
import type { WorkspaceContext } from '../../common/context';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { openApiDocument } from './openapi';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  @Public()
  @Get('health')
  async health() {
    const [db, redis] = await Promise.all([
      this.prisma.db.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.redis.client.ping().then(() => true).catch(() => false),
    ]);
    return { status: db && redis ? 'ok' : 'degraded', database: db, redis, time: new Date().toISOString() };
  }

  @Public()
  @Get('openapi.json')
  openapi() {
    return openApiDocument();
  }

  /** Feature flags evaluated for the current workspace. */
  @RequirePermission('workspace:read')
  @Get('feature-flags')
  async flags(@Ws() ws: WorkspaceContext) {
    const flags = await this.prisma.db.featureFlag.findMany();
    const bucket = [...ws.workspaceId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 100, 7);
    return Object.fromEntries(flags.map((f) => [f.key, f.workspaceIds.includes(ws.workspaceId) || (f.enabled && bucket < f.rolloutPercentage)]));
  }
}
