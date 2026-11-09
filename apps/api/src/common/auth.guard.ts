import { ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { safeEqual, sha256 } from '@simplyai/db';
import { permissionsForScopes, type Permission } from '@simplyai/shared';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { clientIp, type AppRequest } from './context';
import { PERMISSION_KEY, PLATFORM_ADMIN_KEY, PUBLIC_KEY, RATE_LIMIT_KEY, SESSION_ONLY_KEY } from './decorators';

export const SESSION_COOKIE = 'sai_session';
export const CSRF_COOKIE = 'sai_csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

interface CachedRole { permissions: string[]; key: string; organizationId: string; at: number }

/**
 * Global guard: authentication (session cookie or API key), CSRF validation
 * for cookie sessions, rate limiting, workspace membership and permissions.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private memberCache = new Map<string, CachedRole>();

  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  private meta<T>(key: string, ctx: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const res = ctx.switchToHttp().getResponse();

    const rl = this.meta<{ limit: number; windowSec: number }>(RATE_LIMIT_KEY, ctx);
    if (rl) {
      const r = await this.redis.rateLimit(`ip:${ctx.getClass().name}.${ctx.getHandler().name}:${clientIp(req)}`, rl.limit, rl.windowSec);
      if (!r.ok) throw new HttpException({ message: 'Too many requests, please try again later' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const isPublic = this.meta<boolean>(PUBLIC_KEY, ctx);
    await this.authenticate(req);
    if (isPublic) return true;
    if (!req.auth) throw new UnauthorizedException('Authentication required');

    if (req.auth.kind === 'apiKey') {
      if (this.meta<boolean>(SESSION_ONLY_KEY, ctx)) throw new ForbiddenException('This endpoint is not available with API keys');
      const key = req.auth.apiKey;
      const r = await this.redis.rateLimit(`key:${key.id}`, key.rateLimitPerMinute, 60);
      res.setHeader('x-ratelimit-limit', String(key.rateLimitPerMinute));
      res.setHeader('x-ratelimit-remaining', String(r.remaining));
      if (!r.ok) throw new HttpException({ message: 'API key rate limit exceeded' }, HttpStatus.TOO_MANY_REQUESTS);
    } else if (!SAFE_METHODS.has(req.method)) {
      const header = String(req.headers['x-csrf-token'] ?? '');
      if (!header || !safeEqual(header, req.auth.session.csrfToken)) throw new ForbiddenException('Invalid CSRF token');
    }

    if (this.meta<boolean>(PLATFORM_ADMIN_KEY, ctx)) {
      if (req.auth.kind !== 'session' || !req.auth.user.isPlatformAdmin) throw new ForbiddenException('Platform administrators only');
    }

    const perms = this.meta<Permission[]>(PERMISSION_KEY, ctx);
    if (perms) await this.authorizeWorkspace(req, perms);
    return true;
  }

  private async authenticate(req: AppRequest): Promise<void> {
    const authz = String(req.headers.authorization ?? '');
    const headerKey = authz.startsWith('Bearer sai_') ? authz.slice(7) : String(req.headers['x-api-key'] ?? '');
    if (headerKey.startsWith('sai_')) {
      const apiKey = await this.prisma.db.apiKey.findUnique({ where: { keyHash: sha256(headerKey) } });
      if (!apiKey || apiKey.revokedAt || (apiKey.expiresAt && apiKey.expiresAt < new Date())) throw new UnauthorizedException('Invalid or expired API key');
      req.auth = { kind: 'apiKey', apiKey, user: null };
      if (!apiKey.lastUsedAt || Date.now() - apiKey.lastUsedAt.getTime() > 60_000)
        void this.prisma.db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
      return;
    }
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token) return;
    const session = await this.prisma.db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!session || session.expiresAt < new Date() || session.user.status !== 'ACTIVE') return;
    const { user, ...s } = session;
    req.auth = { kind: 'session', user, session: s };
    if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000)
      void this.prisma.db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }

  private async authorizeWorkspace(req: AppRequest, required: Permission[]): Promise<void> {
    const auth = req.auth!;
    if (auth.kind === 'apiKey') {
      const ws = await this.prisma.db.workspace.findUnique({ where: { id: auth.apiKey.workspaceId }, select: { organizationId: true } });
      if (!ws) throw new UnauthorizedException('Workspace no longer exists');
      const granted = permissionsForScopes(auth.apiKey.scopes);
      if (!required.every((p) => granted.includes(p))) throw new ForbiddenException(`API key is missing the scope for: ${required.join(', ')}`);
      req.ws = { workspaceId: auth.apiKey.workspaceId, organizationId: ws.organizationId, permissions: granted, roleKey: 'api', userId: null };
      return;
    }
    const workspaceId = String(req.headers['x-workspace-id'] ?? req.query.workspaceId ?? '');
    if (!workspaceId) throw new ForbiddenException('Select a workspace (x-workspace-id header)');
    const cacheKey = `${auth.user.id}:${workspaceId}`;
    let cached = this.memberCache.get(cacheKey);
    if (!cached || Date.now() - cached.at > 15_000) {
      const member = await this.prisma.db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: auth.user.id } },
        include: { role: true, workspace: { select: { organizationId: true } } },
      });
      if (!member) throw new ForbiddenException('You are not a member of this workspace');
      cached = { permissions: member.role.permissions, key: member.role.key, organizationId: member.workspace.organizationId, at: Date.now() };
      this.memberCache.set(cacheKey, cached);
      if (this.memberCache.size > 10_000) this.memberCache.clear();
    }
    const missing = required.filter((p) => !cached!.permissions.includes(p));
    if (missing.length) throw new ForbiddenException(`Your role (${cached.key}) does not allow: ${missing.join(', ')}`);
    req.ws = { workspaceId, organizationId: cached.organizationId, permissions: cached.permissions, roleKey: cached.key, userId: auth.user.id };
  }

  invalidate(userId: string, workspaceId: string) {
    this.memberCache.delete(`${userId}:${workspaceId}`);
  }
}
