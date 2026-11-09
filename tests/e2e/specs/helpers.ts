import { expect, type Page } from '@playwright/test';

export const DEMO = { email: process.env.E2E_EMAIL ?? 'admin@simplyai.dev', password: process.env.E2E_PASSWORD ?? 'SimplyAI-demo1' };

export async function login(page: Page, email = DEMO.email, password = DEMO.password) {
  await page.goto('/login');
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', password);
  await page.click('button:has-text("Sign in")');
  await expect(page).toHaveURL(/\/overview/);
}
