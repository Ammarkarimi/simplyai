import { Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import { runAppQuerySchema, type AppDefinition } from '@simplyai/shared';
import { Public, RateLimit, Req } from '../../common/decorators';
import type { AppRequest } from '../../common/context';
import { zbody } from '../../common/zod.pipe';
import { PrismaService } from '../../infra/prisma.service';
import { AppsService } from './apps.service';

const runSchema = runAppQuerySchema.omit({ query: true });

/** Serves published apps: public ones to anyone, private ones to workspace members. */
@Controller('public/apps')
export class AppsRuntimeController {
  constructor(private readonly prisma: PrismaService, private readonly apps: AppsService) {}

  private async load(slug: string, req: AppRequest) {
    const app = await this.prisma.db.app.findUnique({ where: { slug: slug.toLowerCase() }, include: { publishedVersion: true } });
    if (!app?.publishedVersion) throw new NotFoundException('This app does not exist or is not published');
    let user: { id: string; name: string | null; email: string } | null = null;
    if (req.auth?.kind === 'session') user = { id: req.auth.user.id, name: req.auth.user.name, email: req.auth.user.email };
    if (app.access === 'PRIVATE') {
      if (!user) throw new UnauthorizedException({ message: 'Sign in to open this app', code: 'LOGIN_REQUIRED' });
      const member = await this.prisma.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: app.workspaceId, userId: user.id } }, include: { role: true } });
      if (!member) throw new NotFoundException('This app does not exist or is not published');
      if (!member.role.permissions.includes('app:read')) throw new ForbiddenException('Your role does not allow opening apps');
    }
    return { app, user, definition: app.publishedVersion.definition as unknown as AppDefinition };
  }

  @Public()
  @RateLimit(120, 60)
  @Get(':slug')
  async get(@Param('slug') slug: string, @Req() req: AppRequest) {
    const { app, user, definition } = await this.load(slug, req);
    return { id: app.id, name: app.name, slug: app.slug, icon: app.icon, color: app.color, access: app.access, version: app.publishedVersion!.version, definition, user: user ? { name: user.name, email: user.email } : null };
  }

  @Public()
  @RateLimit(120, 60)
  @HttpCode(200)
  @Post(':slug/queries/:queryId')
  async run(@Param('slug') slug: string, @Param('queryId') queryId: string, @Body(zbody(runSchema)) body: z.infer<typeof runSchema>, @Req() req: AppRequest) {
    const { app, user, definition } = await this.load(slug, req);
    const query = this.apps.findQuery(definition, queryId);
    return this.apps.run(query, body.args, { workspaceId: app.workspaceId, test: false, userId: user?.id ?? null });
  }
}
