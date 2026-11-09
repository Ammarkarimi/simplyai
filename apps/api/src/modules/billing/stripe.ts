import { createHmac } from 'node:crypto';
import { safeEqual } from '@simplyai/db';
import { env } from '@simplyai/core';
import { httpRequest } from '@simplyai/sdk';

function form(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? Object.assign(out, form(x as Record<string, unknown>, `${key}[${i}]`)) : (out[`${key}[${i}]`] = String(x))));
    else if (typeof v === 'object') Object.assign(out, form(v as Record<string, unknown>, key));
    else out[key] = String(v);
  }
  return out;
}

export async function stripe<T = any>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: Record<string, unknown>): Promise<T> {
  const res = await httpRequest<T>({
    url: `https://api.stripe.com/v1${path}`, method, bodyType: 'form', body: body ? form(body) : undefined,
    headers: { authorization: `Bearer ${env.stripeSecretKey}` },
  });
  return res.body;
}

/** Verify the Stripe-Signature header (v1 scheme, 5 minute tolerance). */
export function verifyStripeSignature(raw: Buffer, header: string, secret: string): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = parts.t;
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${raw.toString('utf8')}`).digest('hex');
  return header.split(',').filter((p) => p.startsWith('v1=')).some((p) => safeEqual(p.slice(3), expected));
}
