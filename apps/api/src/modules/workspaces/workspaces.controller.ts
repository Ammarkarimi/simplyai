import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { randomToken, sha256, type User } from '@simplyai/db';
import { audit, assertCountLimit, env } from '@simplyai/core';
import { inviteMemberSchema, PERMISSIONS, updateMemberSchema, updateWorkspaceSchema, listQuerySchema } from '@simplyai/shared';
import { CurrentUser, Public, RequirePermission, SessionOnly, Ws } from '../../common/decorators';
import type { WorkspaceContext } from '../../common/context';
import { zbody, ZodPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../infra/prisma.service';
import { MailService } from '../../infra/mail.service';
import { AuthGuard } from '../../common/auth.guard';
import { paginate, pageResult } from '../../common/pagination';

const roleSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]{2,40}$/),
  name: z.string().min(1).max(60),
  description: z.string().max(300).optional(),
  permissions: z.array(z.enum(PERMISSIONS)).min(1),
});

@Controller()
export class WorkspacesController {
  constructor(private readonly prisma: PrismaService, private readonly mail: MailService, private readonly guard: AuthGuard) {}

  private get db() {
    return this.prisma.db;
  }

  @RequirePermission('workspace:read')
  @Get('workspace')
  async current(@Ws() ws: WorkspaceContext) {
    const w = await this.db.workspace.findUniqueOrThrow({ where: { id: ws.workspaceId }, include: { organization: true, _count: { select: { members: true, workflows: true } } } });
    return { ...w, role: ws.roleKey, permissions: ws.permissions };
  }

  @RequirePermission('workspace:update')
  @Patch('workspace')
  async update(@Ws() ws: WorkspaceContext, @Body(zbody(updateWorkspaceSchema)) body: z.infer<typeof updateWorkspaceSchema>) {
    const w = await this.db.workspace.update({ where: { id: ws.workspaceId }, data: body });
    await audit(this.db, { action: 'workspace.updated', userId: ws.userId, workspaceId: ws.workspaceId, metadata: body });
    return w;
  }

  @SessionOnly()
  @RequirePermission('workspace:delete')
  @Delete('workspace')
  async remove(@Ws() ws: WorkspaceContext) {
    const count = await this.db.workspace.count({ where: { organizationId: ws.organizationId } });
    if (count <= 1) throw new BadRequestException('An organization must keep at least one workspace');
    await this.db.workspace.delete({ where: { id: ws.workspaceId } });
    await audit(this.db, { action: 'workspace.deleted', userId: ws.userId, organizationId: ws.organizationId, resourceId: ws.workspaceId });
    return { ok: true };
  }

  // ─── Members ───

  @RequirePermission('members:read')
  @Get('team/members')
  async members(@Ws() ws: WorkspaceContext) {
    const rows = await this.db.workspaceMember.findMany({ where: { workspaceId: ws.workspaceId }, include: { user: true, role: true }, orderBy: { createdAt: 'asc' } });
    return rows.map((m) => ({
      id: m.id, joinedAt: m.createdAt,
      user: { id: m.user.id, name: m.user.name, email: m.user.email, avatarUrl: m.user.avatarUrl, lastLoginAt: m.user.lastLoginAt },
      role: { id: m.role.id, key: m.role.key, name: m.role.name, rank: m.role.rank },
    }));
  }

  private async rankOf(ws: WorkspaceContext): Promise<number> {
    if (!ws.userId) return 0;
    const m = await this.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ws.workspaceId, userId: ws.userId } }, include: { role: true } });
    return m?.role.rank ?? 0;
  }

  private async findRole(workspaceId: string, key: string) {
    const role = await this.db.role.findFirst({ where: { key, OR: [{ workspaceId: null }, { workspaceId }] }, orderBy: { workspaceId: 'desc' } });
    if (!role) throw new BadRequestException(`Unknown role "${key}"`);
    return role;
  }

  @SessionOnly()
  @RequirePermission('members:manage')
  @Patch('team/members/:userId')
  async updateMember(@Ws() ws: WorkspaceContext, @Param('userId') userId: string, @Body(zbody(updateMemberSchema)) body: z.infer<typeof updateMemberSchema>) {
    const member = await this.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ws.workspaceId, userId } }, include: { role: true } });
    if (!member) throw new NotFoundException('Member not found');
    const role = await this.findRole(ws.workspaceId, body.roleKey);
    const myRank = await this.rankOf(ws);
    if (role.rank > myRank || member.role.rank > myRank) throw new ForbiddenException('You cannot manage roles above your own');
    if (member.role.key === 'owner' && role.key !== 'owner') {
      const owners = await this.db.workspaceMember.count({ where: { workspaceId: ws.workspaceId, role: { key: 'owner' } } });
      if (owners <= 1) throw new BadRequestException('The workspace needs at least one owner');
    }
    await this.db.workspaceMember.update({ where: { id: member.id }, data: { roleId: role.id } });
    this.guard.invalidate(userId, ws.workspaceId);
    await audit(this.db, { action: 'member.role_changed', userId: ws.userId, workspaceId: ws.workspaceId, resourceType: 'user', resourceId: userId, metadata: { from: member.role.key, to: role.key } });
    return { ok: true };
  }

  @SessionOnly()
  @RequirePermission('members:read')
  @Delete('team/members/:userId')
  async removeMember(@Ws() ws: WorkspaceContext, @Param('userId') userId: string) {
    const self = userId === ws.userId;
    if (!self && !ws.permissions.includes('members:manage')) throw new ForbiddenException('You cannot remove other members');
    const member = await this.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ws.workspaceId, userId } }, include: { role: true } });
    if (!member) throw new NotFoundException('Member not found');
    if (!self && member.role.rank > (await this.rankOf(ws))) throw new ForbiddenException('You cannot remove a member with a higher role');
    if (member.role.key === 'owner') {
      const owners = await this.db.workspaceMember.count({ where: { workspaceId: ws.workspaceId, role: { key: 'owner' } } });
      if (owners <= 1) throw new BadRequestException('The last owner cannot leave the workspace');
    }
    await this.db.workspaceMember.delete({ where: { id: member.id } });
    this.guard.invalidate(userId, ws.workspaceId);
    await audit(this.db, { action: self ? 'member.left' : 'member.removed', userId: ws.userId, workspaceId: ws.workspaceId, resourceType: 'user', resourceId: userId });
    return { ok: true };
  }

  // ─── Invitations ───

  @RequirePermission('members:read')
  @Get('team/invitations')
  async invitations(@Ws() ws: WorkspaceContext) {
    const rows = await this.db.invitation.findMany({ where: { workspaceId: ws.workspaceId, acceptedAt: null, revokedAt: null }, include: { role: true, invitedBy: true }, orderBy: { createdAt: 'desc' } });
    return rows.map((i) => ({ id: i.id, email: i.email, role: { key: i.role.key, name: i.role.name }, invitedBy: i.invitedBy.name, expiresAt: i.expiresAt, expired: i.expiresAt < new Date(), createdAt: i.createdAt }));
  }

  @SessionOnly()
  @RequirePermission('members:manage')
  @Post('team/invitations')
  async invite(@Ws() ws: WorkspaceContext, @CurrentUser() user: User, @Body(zbody(inviteMemberSchema)) body: z.infer<typeof inviteMemberSchema>) {
    const role = await this.findRole(ws.workspaceId, body.roleKey);
    if (role.rank > (await this.rankOf(ws))) throw new ForbiddenException('You cannot invite with a role above your own');
    const existingMember = await this.db.workspaceMember.findFirst({ where: { workspaceId: ws.workspaceId, user: { email: body.email } } });
    if (existingMember) throw new BadRequestException('This person is already a member');
    const members = await this.db.workspaceMember.count({ where: { workspace: { organizationId: ws.organizationId } } });
    const pending = await this.db.invitation.count({ where: { workspace: { organizationId: ws.organizationId }, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
    await assertCountLimit(this.db, ws.organizationId, 'maxMembers', members + pending);
    await this.db.invitation.updateMany({ where: { workspaceId: ws.workspaceId, email: body.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const token = randomToken(32);
    const inv = await this.db.invitation.create({
      data: { workspaceId: ws.workspaceId, email: body.email, roleId: role.id, tokenHash: sha256(token), invitedById: user.id, expiresAt: new Date(Date.now() + 7 * 86_400_000) },
      include: { workspace: true },
    });
    const url = `${env.appUrl}/invite/${encodeURIComponent(token)}`;
    await this.mail.send(body.email, `${user.name} invited you to ${inv.workspace.name} on SimplyAI`, `Join ${inv.workspace.name}: ${url}`, this.mail.layout(`Join ${inv.workspace.name}`, `${user.name} invited you to collaborate as ${role.name}.`, { label: 'Accept invitation', url }));
    await audit(this.db, { action: 'member.invited', userId: user.id, workspaceId: ws.workspaceId, metadata: { email: body.email, role: role.key } });
    return { id: inv.id, email: inv.email, inviteUrl: url, emailSent: this.mail.configured };
  }

  @SessionOnly()
  @RequirePermission('members:manage')
  @Delete('team/invitations/:id')
  async revokeInvitation(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const r = await this.db.invitation.updateMany({ where: { id, workspaceId: ws.workspaceId }, data: { revokedAt: new Date() } });
    if (!r.count) throw new NotFoundException();
    return { ok: true };
  }

  @Public()
  @Get('invitations/:token')
  async invitationInfo(@Param('token') token: string) {
    const inv = await this.db.invitation.findUnique({ where: { tokenHash: sha256(token) }, include: { workspace: true, role: true, invitedBy: true } });
    if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt < new Date()) throw new NotFoundException('This invitation is invalid or has expired');
    const hasAccount = !!(await this.db.user.findUnique({ where: { email: inv.email } }));
    return { email: inv.email, workspace: inv.workspace.name, role: inv.role.name, invitedBy: inv.invitedBy.name, hasAccount };
  }

  @SessionOnly()
  @HttpCode(200)
  @Post('invitations/:token/accept')
  async accept(@Param('token') token: string, @CurrentUser() user: User) {
    const inv = await this.db.invitation.findUnique({ where: { tokenHash: sha256(token) }, include: { workspace: true } });
    if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt < new Date()) throw new NotFoundException('This invitation is invalid or has expired');
    if (inv.email.toLowerCase() !== user.email.toLowerCase()) throw new ForbiddenException(`This invitation was sent to ${inv.email}`);
    await this.db.$transaction([
      this.db.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId: user.id } }, create: { workspaceId: inv.workspaceId, userId: user.id, roleId: inv.roleId }, update: {} }),
      this.db.organizationMember.upsert({ where: { organizationId_userId: { organizationId: inv.workspace.organizationId, userId: user.id } }, create: { organizationId: inv.workspace.organizationId, userId: user.id, role: 'MEMBER' }, update: {} }),
      this.db.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } }),
    ]);
    await audit(this.db, { action: 'member.joined', userId: user.id, workspaceId: inv.workspaceId });
    return { workspaceId: inv.workspaceId };
  }

  // ─── Roles ───

  @RequirePermission('members:read')
  @Get('team/roles')
  async roles(@Ws() ws: WorkspaceContext) {
    return this.db.role.findMany({ where: { OR: [{ workspaceId: null }, { workspaceId: ws.workspaceId }] }, orderBy: [{ rank: 'desc' }, { name: 'asc' }] });
  }

  @SessionOnly()
  @RequirePermission('members:manage')
  @Post('team/roles')
  async createRole(@Ws() ws: WorkspaceContext, @Body(zbody(roleSchema)) body: z.infer<typeof roleSchema>) {
    if (['owner', 'admin', 'editor', 'operator', 'viewer'].includes(body.key)) throw new BadRequestException('This key is reserved for system roles');
    const myRank = await this.rankOf(ws);
    const mine = new Set(ws.permissions);
    if (body.permissions.some((p) => !mine.has(p))) throw new ForbiddenException('Custom roles cannot grant permissions you do not have');
    return this.db.role.create({ data: { ...body, workspaceId: ws.workspaceId, rank: Math.min(myRank - 1, 50) } });
  }

  @SessionOnly()
  @RequirePermission('members:manage')
  @Delete('team/roles/:id')
  async deleteRole(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const role = await this.db.role.findFirst({ where: { id, workspaceId: ws.workspaceId } });
    if (!role) throw new NotFoundException('Custom role not found');
    if (await this.db.workspaceMember.count({ where: { roleId: id } })) throw new BadRequestException('Reassign members before deleting this role');
    await this.db.role.delete({ where: { id } });
    return { ok: true };
  }

  // ─── Audit log ───

  @RequirePermission('audit:read')
  @Get('audit-logs')
  async auditLogs(@Ws() ws: WorkspaceContext, @Query(new ZodPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>) {
    const where = { workspaceId: ws.workspaceId, ...(q.search ? { action: { contains: q.search } } : {}) };
    const [items, total] = await Promise.all([
      this.db.auditLog.findMany({ where, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: 'desc' }, ...paginate(q.page, q.pageSize) }),
      this.db.auditLog.count({ where }),
    ]);
    return pageResult(items, total, q.page, q.pageSize);
  }
}
