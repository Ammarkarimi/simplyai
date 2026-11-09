import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { hashPassword, randomToken, sha256, verifyPassword, type Prisma, type User } from '@simplyai/db';
import { env, audit, assertCountLimit } from '@simplyai/core';
import { slugify, type SignUpInput } from '@simplyai/shared';
import { PrismaService } from '../../infra/prisma.service';
import { MailService } from '../../infra/mail.service';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly mail: MailService) {}

  private get db() {
    return this.prisma.db;
  }

  async systemRole(key: string) {
    const role = await this.db.role.findFirst({ where: { workspaceId: null, key } });
    if (!role) throw new Error(`System role ${key} is missing; run the database seed`);
    return role;
  }

  async uniqueOrgSlug(name: string, tx: Prisma.TransactionClient = this.db): Promise<string> {
    const base = slugify(name);
    for (let i = 0; i < 50; i++) {
      const slug = i ? `${base}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}` : base;
      if (!(await tx.organization.findUnique({ where: { slug } }))) return slug;
    }
    return `${base}-${Date.now()}`;
  }

  /** Create an organization with a default workspace for a new user. */
  async bootstrapOrganization(tx: Prisma.TransactionClient, user: User, orgName: string) {
    const ownerRole = await this.systemRole('owner');
    const free = await tx.plan.findUnique({ where: { key: 'free' } });
    const org = await tx.organization.create({
      data: { name: orgName, slug: await this.uniqueOrgSlug(orgName, tx), members: { create: { userId: user.id, role: 'OWNER' } } },
    });
    if (free) await tx.subscription.create({ data: { organizationId: org.id, planId: free.id, currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
    const workspace = await tx.workspace.create({
      data: { organizationId: org.id, name: 'My Workspace', slug: 'my-workspace', members: { create: { userId: user.id, roleId: ownerRole.id } } },
    });
    return { org, workspace };
  }

  async signUp(input: SignUpInput) {
    const existing = await this.db.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException('An account with this email already exists');
    let invitation = null;
    if (input.inviteToken) {
      invitation = await this.db.invitation.findUnique({ where: { tokenHash: sha256(input.inviteToken) }, include: { workspace: true } });
      if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt < new Date()) throw new BadRequestException('This invitation is invalid or has expired');
      if (invitation.email.toLowerCase() !== input.email) throw new BadRequestException('This invitation was sent to a different email address');
    }
    const passwordHash = await hashPassword(input.password);
    const user = await this.db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email: input.email, name: input.name, passwordHash,
          isPlatformAdmin: env.platformAdminEmails.includes(input.email),
          emailVerifiedAt: invitation ? new Date() : null,
        },
      });
      if (invitation) {
        await tx.workspaceMember.create({ data: { workspaceId: invitation.workspaceId, userId: u.id, roleId: invitation.roleId } });
        await tx.organizationMember.upsert({
          where: { organizationId_userId: { organizationId: invitation.workspace.organizationId, userId: u.id } },
          create: { organizationId: invitation.workspace.organizationId, userId: u.id, role: 'MEMBER' }, update: {},
        });
        await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
      } else {
        await this.bootstrapOrganization(tx, u, input.organizationName || `${input.name.split(' ')[0]}'s Team`);
      }
      return u;
    });
    if (!invitation) await this.sendVerification(user);
    await audit(this.db, { action: 'user.signup', userId: user.id, metadata: { invited: !!invitation } });
    return user;
  }

  async login(email: string, password: string) {
    const user = await this.db.user.findUnique({ where: { email } });
    const ok = user?.passwordHash ? await verifyPassword(user.passwordHash, password) : false;
    if (!user || !ok) {
      if (user) await audit(this.db, { action: 'user.login_failed', userId: user.id });
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('This account is suspended');
    if (!user.isPlatformAdmin && env.platformAdminEmails.includes(user.email)) await this.db.user.update({ where: { id: user.id }, data: { isPlatformAdmin: true } });
    return user;
  }

  private async createToken(userId: string, type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET', ttlMs: number) {
    const token = randomToken(32);
    await this.db.verificationToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
    await this.db.verificationToken.create({ data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) } });
    return token;
  }

  private async consumeToken(token: string, type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET') {
    const row = await this.db.verificationToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.type !== type || row.usedAt || row.expiresAt < new Date()) throw new BadRequestException('This link is invalid or has expired');
    await this.db.verificationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    return row;
  }

  async sendVerification(user: User) {
    if (user.emailVerifiedAt) return;
    const token = await this.createToken(user.id, 'EMAIL_VERIFICATION', 48 * 3_600_000);
    const url = `${env.appUrl}/verify-email?token=${encodeURIComponent(token)}`;
    await this.mail.send(user.email, 'Verify your SimplyAI email', `Hi ${user.name}, verify your email: ${url}`, this.mail.layout('Verify your email', `Hi ${user.name}, confirm your email address to secure your account.`, { label: 'Verify email', url }));
  }

  async verifyEmail(token: string) {
    const row = await this.consumeToken(token, 'EMAIL_VERIFICATION');
    await this.db.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
  }

  async forgotPassword(email: string) {
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user) return;
    const token = await this.createToken(user.id, 'PASSWORD_RESET', 60 * 60_000);
    const url = `${env.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await this.mail.send(user.email, 'Reset your SimplyAI password', `Reset your password: ${url} (valid for 1 hour)`, this.mail.layout('Reset your password', 'We received a request to reset your password. The link is valid for one hour.', { label: 'Reset password', url }));
  }

  async resetPassword(token: string, password: string) {
    const row = await this.consumeToken(token, 'PASSWORD_RESET');
    await this.db.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(password), emailVerifiedAt: new Date() } });
    await this.db.session.deleteMany({ where: { userId: row.userId } });
    await audit(this.db, { action: 'user.password_reset', userId: row.userId });
  }

  async changePassword(user: User, current: string | undefined, next: string) {
    if (user.passwordHash && !(current && (await verifyPassword(user.passwordHash, current)))) throw new BadRequestException('Current password is incorrect');
    await this.db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
    await audit(this.db, { action: 'user.password_changed', userId: user.id });
  }

  async me(user: User) {
    const [memberships, orgs] = await Promise.all([
      this.db.workspaceMember.findMany({ where: { userId: user.id }, include: { workspace: true, role: true }, orderBy: { createdAt: 'asc' } }),
      this.db.organizationMember.findMany({ where: { userId: user.id }, include: { organization: { include: { subscription: { include: { plan: true } } } } } }),
    ]);
    return {
      user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl, emailVerified: !!user.emailVerifiedAt, isPlatformAdmin: user.isPlatformAdmin, hasPassword: !!user.passwordHash, createdAt: user.createdAt },
      workspaces: memberships.map((m) => ({
        id: m.workspace.id, name: m.workspace.name, slug: m.workspace.slug, organizationId: m.workspace.organizationId, activeEnvironment: m.workspace.activeEnvironment, timezone: m.workspace.timezone,
        role: { key: m.role.key, name: m.role.name, permissions: m.role.permissions },
      })),
      organizations: orgs.map((o) => ({ id: o.organization.id, name: o.organization.name, slug: o.organization.slug, role: o.role, plan: o.organization.subscription?.plan.key ?? 'free' })),
      features: {
        googleLogin: !!(env.googleClientId && env.googleClientSecret),
        email: !!process.env.SMTP_HOST,
        billing: !!env.stripeSecretKey,
      },
    };
  }

  /** Find or create a user from Google profile data. */
  async googleUser(profile: { sub: string; email: string; name?: string; picture?: string; email_verified?: boolean }) {
    let user = await this.db.user.findUnique({ where: { googleId: profile.sub } });
    if (user) return user;
    const email = profile.email.toLowerCase();
    user = await this.db.user.findUnique({ where: { email } });
    if (user) {
      if (!profile.email_verified) throw new UnauthorizedException('Google account email is not verified');
      return this.db.user.update({ where: { id: user.id }, data: { googleId: profile.sub, avatarUrl: user.avatarUrl ?? profile.picture, emailVerifiedAt: user.emailVerifiedAt ?? new Date() } });
    }
    return this.db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { email, name: profile.name || email.split('@')[0]!, googleId: profile.sub, avatarUrl: profile.picture, emailVerifiedAt: new Date(), isPlatformAdmin: env.platformAdminEmails.includes(email) },
      });
      await this.bootstrapOrganization(tx, u, `${(profile.name || email).split(' ')[0]}'s Team`);
      return u;
    });
  }

  async createWorkspace(user: User, name: string, organizationId?: string, description?: string) {
    const orgMember = organizationId
      ? await this.db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId: user.id } } })
      : await this.db.organizationMember.findFirst({ where: { userId: user.id, role: { in: ['OWNER', 'ADMIN'] } }, orderBy: { createdAt: 'asc' } });
    if (!orgMember || orgMember.role === 'MEMBER') throw new BadRequestException('Only organization owners and admins can create workspaces');
    const count = await this.db.workspace.count({ where: { organizationId: orgMember.organizationId } });
    await assertCountLimit(this.db, orgMember.organizationId, 'maxWorkspaces', count);
    const ownerRole = await this.systemRole('owner');
    let slug = slugify(name);
    if (await this.db.workspace.findUnique({ where: { organizationId_slug: { organizationId: orgMember.organizationId, slug } } })) slug = `${slug}-${count + 1}`;
    return this.db.workspace.create({
      data: { organizationId: orgMember.organizationId, name, slug, description, members: { create: { userId: user.id, roleId: ownerRole.id } } },
    });
  }
}
