import { beforeAll, describe, expect, it } from 'vitest';
import { decrypt, decryptJson, encrypt, encryptJson, sha256 } from './crypto';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = '0'.repeat(64);
});

describe('crypto', () => {
  it('round-trips with matching aad', () => {
    const c = encrypt('secret', 'ws1');
    expect(c).not.toContain('secret');
    expect(decrypt(c, 'ws1')).toBe('secret');
  });
  it('rejects a different tenant (aad)', () => {
    const c = encrypt('secret', 'ws1');
    expect(() => decrypt(c, 'ws2')).toThrow();
  });
  it('detects tampering', () => {
    const c = encrypt('secret', 'ws1');
    const parts = c.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decrypt(parts.join(':'), 'ws1')).toThrow();
  });
  it('json helpers', () => {
    expect(decryptJson(encryptJson({ a: 1 }, 'x'), 'x')).toEqual({ a: 1 });
  });
  it('hashes deterministically', () => expect(sha256('a')).toBe(sha256('a')));
});
