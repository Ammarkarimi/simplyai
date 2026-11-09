import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('sign up creates a workspace and shows the dashboard', async ({ page }) => {
  const email = `e2e.${Date.now()}@test.dev`;
  await page.goto('/signup');
  await page.fill('input[name=name]', 'E2E User');
  await page.fill('input[name=email]', email);
  await page.fill('input[name=organizationName]', 'E2E Co');
  await page.fill('input[name=password]', 'Password123');
  await page.click('button:has-text("Create account")');
  await expect(page).toHaveURL(/\/overview/);
  await expect(page.getByText('Here is how your automations are performing')).toBeVisible();
  await expect(page.getByText('My Workspace')).toBeVisible();
});

test('rejects invalid credentials', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name=email]', 'admin@simplyai.dev');
  await page.fill('input[name=password]', 'wrong-password-1');
  await page.click('button:has-text("Sign in")');
  await expect(page.getByText('Invalid email or password').first()).toBeVisible();
});

test('protected pages redirect to login', async ({ page }) => {
  await page.goto('/workflows');
  await expect(page).toHaveURL(/\/login/);
  await login(page);
});
