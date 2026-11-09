import { execSync } from 'node:child_process';
import path from 'node:path';

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/simplyai_test?schema=public';
  const dbDir = path.resolve(__dirname, '../../../packages/db');
  execSync('npx prisma migrate deploy', { cwd: dbDir, env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  execSync(`node -e "require('./dist/seed/run').seed({ demo: false }).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); })"`, {
    cwd: dbDir, env: { ...process.env, DATABASE_URL: url, ENCRYPTION_KEY: 'a'.repeat(64) }, stdio: 'pipe',
  });
}
