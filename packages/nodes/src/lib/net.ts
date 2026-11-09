import dns from 'node:dns/promises';
import net from 'node:net';
import { isBlockedAddress, privateNetworkAllowed, SsrfBlockedError } from '@simplyai/sdk';

/** Validate a database/service host against the private network policy. */
export async function assertHostAllowed(host: string): Promise<void> {
  if (privateNetworkAllowed()) return;
  const h = host.trim();
  if (!h || h === 'localhost') throw new SsrfBlockedError(`Connections to ${h || 'an empty host'} are blocked`);
  const addresses = net.isIP(h) ? [h] : (await dns.lookup(h, { all: true })).map((a) => a.address);
  const bad = addresses.find(isBlockedAddress);
  if (bad) throw new SsrfBlockedError(`Connections to ${h} (${bad}) are blocked: private network address`);
}

export const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_$]{0,62}(\.[A-Za-z_][A-Za-z0-9_$]{0,62})?$/;

export function assertIdentifier(name: string, what = 'identifier'): string {
  if (!IDENTIFIER_RE.test(name)) throw new Error(`Invalid ${what} "${name}"`);
  return name;
}
