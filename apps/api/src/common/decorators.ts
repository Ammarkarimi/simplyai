import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@simplyai/shared';
import type { AppRequest, WorkspaceContext } from './context';

export const PUBLIC_KEY = 'sai:public';
export const PERMISSION_KEY = 'sai:permission';
export const PLATFORM_ADMIN_KEY = 'sai:platformAdmin';
export const RATE_LIMIT_KEY = 'sai:rateLimit';
export const SESSION_ONLY_KEY = 'sai:sessionOnly';

/** No authentication required. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Requires a workspace (x-workspace-id header or API key) and the permission(s). */
export const RequirePermission = (...perms: Permission[]) => SetMetadata(PERMISSION_KEY, perms);
export const PlatformAdmin = () => SetMetadata(PLATFORM_ADMIN_KEY, true);
/** Requests per window per client IP (or API key). */
export const RateLimit = (limit: number, windowSec = 60) => SetMetadata(RATE_LIMIT_KEY, { limit, windowSec });
/** API keys are not accepted on this route. */
export const SessionOnly = () => SetMetadata(SESSION_ONLY_KEY, true);

export const Ws = createParamDecorator((_: unknown, ctx: ExecutionContext): WorkspaceContext => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.ws) throw new Error('Workspace context missing; add @RequirePermission to the route');
  return req.ws;
});

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  return req.auth?.kind === 'session' ? req.auth.user : null;
});

export const Req = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AppRequest>());
