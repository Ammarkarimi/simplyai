import { BadRequestException, Body, Controller, Get, HttpCode, Patch, Post, Query, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { randomToken, sha256, type User } from '@simplyai/db';
import { env, audit } from '@simplyai/core';
import {
  changePasswordSchema, createWorkspaceSchema, forgotPasswordSchema, loginSchema, resetPasswordSchema, signUpSchema, updateProfileSchema, verifyEmailSchema,
} from '@simplyai/shared';
import { httpRequest } from '@simplyai/sdk';
import { CurrentUser, Public, RateLimit, Req, SessionOnly } from '../../common/decorators';
import { clientIp, type AppRequest } from '../../common/context';
import { zbody } from '../../common/zod.pipe';
import { PrismaService } from '../../infra/prisma.service';
import { AuthService } from './auth.service';
import { clearSessionCookies, createSession, signToken, verifyToken } from './session';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly prisma: PrismaService) {}

  @Public()
  @RateLimit(10, 60)
  @Post('signup')
  async signUp(@Body(zbody(signUpSchema)) body: z.infer<typeof signUpSchema>, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.signUp(body);
    await createSession(this.prisma.db, res, user.id, { ip: clientIp(req), userAgent: req.headers['user-agent'] });
    return this.auth.me(user);
  }

  @Public()
  @RateLimit(20, 60)
  @HttpCode(200)
  @Post('login')
  async login(@Body(zbody(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.login(body.email, body.password);
    await createSession(this.prisma.db, res, user.id, { ip: clientIp(req), userAgent: req.headers['user-agent'] });
    await audit(this.prisma.db, { action: 'user.login', userId: user.id, ip: clientIp(req), userAgent: req.headers['user-agent'] });
    return this.auth.me(user);
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    if (req.auth?.kind === 'session') await this.prisma.db.session.delete({ where: { id: req.auth.session.id } }).catch(() => undefined);
    clearSessionCookies(res);
    return { ok: true };
  }

  @SessionOnly()
  @Get('me')
  me(@CurrentUser() user: User) {
    return this.auth.me(user);
  }

  @SessionOnly()
  @Patch('profile')
  async updateProfile(@CurrentUser() user: User, @Body(zbody(updateProfileSchema)) body: z.infer<typeof updateProfileSchema>) {
    const u = await this.prisma.db.user.update({ where: { id: user.id }, data: body });
    return this.auth.me(u);
  }

  @SessionOnly()
  @HttpCode(200)
  @Post('change-password')
  async changePassword(@CurrentUser() user: User, @Body(zbody(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>) {
    await this.auth.changePassword(user, body.currentPassword, body.newPassword);
    return { ok: true };
  }

  @SessionOnly()
  @Get('sessions')
  async sessions(@CurrentUser() user: User, @Req() req: AppRequest) {
    const rows = await this.prisma.db.session.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: 'desc' } });
    const current = req.auth?.kind === 'session' ? req.auth.session.id : null;
    return rows.map((s) => ({ id: s.id, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, current: s.id === current }));
  }

  @SessionOnly()
  @HttpCode(200)
  @Post('sessions/revoke-others')
  async revokeOthers(@CurrentUser() user: User, @Req() req: AppRequest) {
    const current = req.auth?.kind === 'session' ? req.auth.session.id : '';
    const r = await this.prisma.db.session.deleteMany({ where: { userId: user.id, NOT: { id: current } } });
    return { revoked: r.count };
  }

  @Public()
  @RateLimit(5, 300)
  @HttpCode(200)
  @Post('forgot-password')
  async forgot(@Body(zbody(forgotPasswordSchema)) body: z.infer<typeof forgotPasswordSchema>) {
    await this.auth.forgotPassword(body.email);
    return { ok: true, message: 'If an account exists for this email, a reset link has been sent.' };
  }

  @Public()
  @RateLimit(10, 300)
  @HttpCode(200)
  @Post('reset-password')
  async reset(@Body(zbody(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>) {
    await this.auth.resetPassword(body.token, body.password);
    return { ok: true };
  }

  @Public()
  @RateLimit(20, 300)
  @HttpCode(200)
  @Post('verify-email')
  async verify(@Body(zbody(verifyEmailSchema)) body: z.infer<typeof verifyEmailSchema>) {
    await this.auth.verifyEmail(body.token);
    return { ok: true };
  }

  @SessionOnly()
  @RateLimit(3, 300)
  @HttpCode(200)
  @Post('resend-verification')
  async resend(@CurrentUser() user: User) {
    await this.auth.sendVerification(user);
    return { ok: true };
  }

  /** Short lived token used to authenticate the WebSocket connection. */
  @SessionOnly()
  @Get('ws-token')
  wsToken(@CurrentUser() user: User) {
    return { token: signToken(user.id, 60) };
  }

  @SessionOnly()
  @Post('workspaces')
  async createWorkspace(@CurrentUser() user: User, @Body(zbody(createWorkspaceSchema)) body: z.infer<typeof createWorkspaceSchema>) {
    const ws = await this.auth.createWorkspace(user, body.name, body.organizationId, body.description);
    await audit(this.prisma.db, { action: 'workspace.created', userId: user.id, workspaceId: ws.id, organizationId: ws.organizationId });
    return ws;
  }

  // ─── Google sign in ───

  @Public()
  @Get('google')
  google(@Res() res: Response) {
    if (!env.googleClientId) throw new BadRequestException('Google sign-in is not configured on this server');
    const nonce = randomToken(16);
    const state = signToken(nonce, 600);
    res.cookie('sai_oauth_state', sha256(nonce), { httpOnly: true, sameSite: 'lax', maxAge: 600_000, path: '/' });
    const params = new URLSearchParams({
      client_id: env.googleClientId, redirect_uri: `${env.appUrl}/api/v1/auth/google/callback`, response_type: 'code',
      scope: 'openid email profile', state, prompt: 'select_account',
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }

  @Public()
  @Get('google/callback')
  async googleCallback(@Query('code') code: string, @Query('state') state: string, @Req() req: AppRequest, @Res() res: Response) {
    try {
      const nonce = state ? verifyToken(state) : null;
      if (!nonce || req.cookies?.sai_oauth_state !== sha256(nonce)) throw new UnauthorizedException('Invalid OAuth state');
      res.clearCookie('sai_oauth_state', { path: '/' });
      const token = await httpRequest<{ access_token: string }>({
        url: 'https://oauth2.googleapis.com/token', method: 'POST', bodyType: 'form',
        body: { code, client_id: env.googleClientId, client_secret: env.googleClientSecret, redirect_uri: `${env.appUrl}/api/v1/auth/google/callback`, grant_type: 'authorization_code' },
      });
      const profile = await httpRequest<{ sub: string; email: string; name?: string; picture?: string; email_verified?: boolean }>({
        url: 'https://openidconnect.googleapis.com/v1/userinfo', headers: { authorization: `Bearer ${token.body.access_token}` },
      });
      const user = await this.auth.googleUser(profile.body);
      if (user.status !== 'ACTIVE') throw new UnauthorizedException('This account is suspended');
      await createSession(this.prisma.db, res, user.id, { ip: clientIp(req), userAgent: req.headers['user-agent'] });
      await audit(this.prisma.db, { action: 'user.login', userId: user.id, metadata: { method: 'google' }, ip: clientIp(req) });
      res.redirect(`${env.appUrl}/overview`);
    } catch (err) {
      res.redirect(`${env.appUrl}/login?error=${encodeURIComponent((err as Error).message)}`);
    }
  }
}
