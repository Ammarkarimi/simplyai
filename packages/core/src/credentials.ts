import { decryptJson, encryptJson, type Credential } from '@simplyai/db';
import type { CredentialTypeDescription } from '@simplyai/shared';

const aad = (workspaceId: string) => `credential:${workspaceId}`;

export function encryptCredentialData(workspaceId: string, data: Record<string, unknown>): string {
  return encryptJson(data, aad(workspaceId));
}

export function decryptCredentialData(cred: Pick<Credential, 'workspaceId' | 'encryptedData'>): Record<string, unknown> {
  return decryptJson(cred.encryptedData, aad(cred.workspaceId));
}

export const MASK = '••••••••';

/** Data safe to show in the UI: secrets are masked, non-secret fields are returned. */
export function maskCredentialData(desc: CredentialTypeDescription | undefined, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of desc?.properties ?? []) {
    const v = data[p.name];
    if (v === undefined || v === '') continue;
    out[p.name] = p.password ? MASK : v;
  }
  return out;
}

/** Merge an update: masked or omitted secret values keep the stored value. */
export function mergeCredentialData(existing: Record<string, unknown>, update: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...existing };
  for (const [k, v] of Object.entries(update)) {
    if (v === MASK) continue;
    merged[k] = v;
  }
  return merged;
}
