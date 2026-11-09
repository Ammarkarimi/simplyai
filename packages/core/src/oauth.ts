import { httpRequest, NodeApiError, type HttpRequestOptions, type ResolvedCredential } from '@simplyai/sdk';
import type { Credential, PrismaClient } from '@simplyai/db';
import { env } from './env';
import { getRegistry } from './registry';
import { decryptCredentialData, encryptCredentialData } from './credentials';

export const oauthRedirectUri = () => `${env.appUrl}/api/v1/oauth2/callback`;

export function oauthConfig(type: string, data: Record<string, unknown>) {
  const def = getRegistry().getCredential(type);
  if (!def || def.authKind !== 'oauth2' || !def.oauth2) throw new NodeApiError(`${type} is not an OAuth2 credential`);
  let authorizationUrl = String(data.authUrl || def.oauth2.authorizationUrl);
  let tokenUrl = String(data.accessTokenUrl || def.oauth2.tokenUrl);
  if (type === 'salesforceOAuth2Api' && data.environment === 'sandbox') {
    authorizationUrl = authorizationUrl.replace('login.salesforce.com', 'test.salesforce.com');
    tokenUrl = tokenUrl.replace('login.salesforce.com', 'test.salesforce.com');
  }
  const extra: Record<string, string> = { ...(def.oauth2.authQueryParameters ?? {}) };
  if (typeof data.authQueryParameters === 'string' && data.authQueryParameters) for (const [k, v] of new URLSearchParams(data.authQueryParameters)) extra[k] = v;
  return { authorizationUrl, tokenUrl, scope: String(data.scope ?? def.oauth2.scopes.join(' ')), extra };
}

export function buildAuthorizeUrl(type: string, data: Record<string, unknown>, state: string): string {
  const c = oauthConfig(type, data);
  if (!c.authorizationUrl || !c.tokenUrl) throw new NodeApiError('Authorization and token URLs are required');
  const params = new URLSearchParams({ client_id: String(data.clientId ?? ''), redirect_uri: oauthRedirectUri(), response_type: 'code', state, ...(c.scope ? { scope: c.scope } : {}), ...c.extra });
  return `${c.authorizationUrl}${c.authorizationUrl.includes('?') ? '&' : '?'}${params}`;
}

function tokenData(body: Record<string, unknown>, previous?: Record<string, unknown>) {
  const expiresIn = Number(body.expires_in ?? 0);
  return {
    ...previous,
    ...body,
    refresh_token: body.refresh_token ?? previous?.refresh_token,
    expires_at: expiresIn ? Date.now() + expiresIn * 1000 : null,
  };
}

export async function exchangeOAuthCode(type: string, data: Record<string, unknown>, code: string): Promise<Record<string, unknown>> {
  const c = oauthConfig(type, data);
  const res = await httpRequest<Record<string, unknown>>({
    url: c.tokenUrl, method: 'POST', bodyType: 'form', headers: { accept: 'application/json' },
    body: { grant_type: 'authorization_code', code, redirect_uri: oauthRedirectUri(), client_id: String(data.clientId ?? ''), client_secret: String(data.clientSecret ?? '') },
  });
  if (!res.body.access_token) throw new NodeApiError('The provider did not return an access token', res.status, res.body);
  return tokenData(res.body);
}

/** Refresh an OAuth2 token if it expires within 2 minutes; persists the new token. */
export async function refreshOAuthIfNeeded(db: PrismaClient, cred: Credential, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tok = data.oauthTokenData as Record<string, unknown> | undefined;
  if (!tok?.access_token) throw new NodeApiError(`Credential "${cred.name}" is not connected. Open Credentials and click Connect.`);
  const expiresAt = Number(tok.expires_at ?? 0);
  if (!expiresAt || expiresAt - Date.now() > 120_000) return data;
  if (!tok.refresh_token) return data;
  const c = oauthConfig(cred.type, data);
  const res = await httpRequest<Record<string, unknown>>({
    url: c.tokenUrl, method: 'POST', bodyType: 'form', headers: { accept: 'application/json' },
    body: { grant_type: 'refresh_token', refresh_token: String(tok.refresh_token), client_id: String(data.clientId ?? ''), client_secret: String(data.clientSecret ?? '') },
  }).catch(async (err) => {
    await db.credential.update({ where: { id: cred.id }, data: { status: 'ERROR', statusMessage: `Token refresh failed: ${(err as Error).message}` } });
    throw err;
  });
  const next = { ...data, oauthTokenData: tokenData(res.body, tok) };
  await db.credential.update({ where: { id: cred.id }, data: { encryptedData: encryptCredentialData(cred.workspaceId, next), status: 'ACTIVE', statusMessage: null } });
  return next;
}

export async function resolveCredential(db: PrismaClient, workspaceId: string, credentialId: string, acceptedTypes: string[]): Promise<ResolvedCredential> {
  const cred = await db.credential.findFirst({ where: { id: credentialId, workspaceId } });
  if (!cred) throw new NodeApiError('The selected credential does not exist in this workspace');
  if (acceptedTypes.length && !acceptedTypes.includes(cred.type)) throw new NodeApiError(`Credential "${cred.name}" (${cred.type}) cannot be used here`);
  let data = decryptCredentialData(cred);
  if (getRegistry().getCredential(cred.type)?.authKind === 'oauth2') data = await refreshOAuthIfNeeded(db, cred, data);
  return { id: cred.id, type: cred.type, data };
}

/** Apply a credential's authentication to a request. */
export function applyCredential(cred: ResolvedCredential, req: HttpRequestOptions): HttpRequestOptions {
  const def = getRegistry().getCredential(cred.type);
  const auth = def?.authenticate?.(cred.data) ?? {};
  let url = req.url;
  if (auth.baseUrl && !/^https?:\/\//i.test(url)) url = auth.baseUrl.replace(/\/$/, '') + (url.startsWith('/') ? url : `/${url}`);
  if (!/^https?:\/\//i.test(url)) throw new NodeApiError(`Request URL "${url}" is not absolute`);
  return { ...req, url, headers: { ...(req.headers ?? {}), ...(auth.headers ?? {}) }, query: { ...(req.query ?? {}), ...(auth.query ?? {}) } };
}
