import { createHmac } from 'node:crypto';
import type { Response } from 'express';
import { randomToken, safeEqual, sha256, type PrismaClient } from '@simplyai/db';
import { env } from '@simplyai/core';
import { CSRF_COOKIE, SESSION_COOKIE } from '../../common/auth.guard';

const SESSION_DAYS = 30;

export async function createSession(db: PrismaClient, res: Response, userId: string, meta: { ip?: string; userAgent?: string }) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.session.create({ data: { userId, tokenHash: sha256(token), csrfToken, expiresAt, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) } });
  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  const secure = env.isProd || env.appUrl.startsWith('https://');
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, expires: expiresAt, path: '/' });
  res.cookie(CSRF_COOKIE, csrfToken, { httpOnly: false, sameSite: 'lax', secure, expires: expiresAt, path: '/' });
  return { csrfToken };
}

export function clearSessionCookies(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
}

/** Short lived HMAC token: payload.expiry.signature */
export function signToken(payload: string, ttlSec: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const body = `${Buffer.from(payload).toString('base64url')}.${exp}`;
  return `${body}.${createHmac('sha256', env.sessionSecret).update(body).digest('base64url')}`;
}

export function verifyToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const body = `${parts[0]}.${parts[1]}`;
  const expected = createHmac('sha256', env.sessionSecret).update(body).digest('base64url');
  if (!safeEqual(expected, parts[2]!)) return null;
  if (Number(parts[1]) < Date.now() / 1000) return null;
  return Buffer.from(parts[0]!, 'base64url').toString('utf8');
}
