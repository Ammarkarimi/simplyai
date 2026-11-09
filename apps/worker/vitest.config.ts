import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globalSetup: ['../api/test/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/simplyai_test?schema=public',
      REDIS_URL: 'redis://localhost:6379/14',
      ENCRYPTION_KEY: 'a'.repeat(64),
      SESSION_SECRET: 'b'.repeat(64),
      ALLOW_PRIVATE_NETWORK: 'true',
    },
  },
});
