import { hash, verify } from '@node-rs/argon2';

// Argon2id, OWASP recommended parameters
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, algorithm: 2 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}
