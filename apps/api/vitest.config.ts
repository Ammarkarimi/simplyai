import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/simplyai_test?schema=public';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DB,
      ENCRYPTION_KEY: 'a'.repeat(64),
      SESSION_SECRET: 'b'.repeat(64),
      APP_URL: 'http://localhost:3000',
      API_URL: 'http://localhost:4000',
      ALLOW_PRIVATE_NETWORK: 'true',
      PLATFORM_ADMIN_EMAILS: 'root@test.dev',
      SMTP_HOST: '',
      RATE_LIMIT_MULTIPLIER: '1000',
      REDIS_URL: 'redis://localhost:6379/14',
    },
  },
});
