import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('creates a data table and adds a row', async ({ page }) => {
  await login(page);
  await page.goto('/data-tables');
  await page.click('button:has-text("New table")');
  await page.fill('input[name=name]', `E2E ${Date.now()}`);
  await page.click('button:has-text("Create table")');
  await expect(page).toHaveURL(/\/data-tables\/.+/);
  await page.click('button:has-text("Add row")');
  await page.fill('input[name=name]', 'Ada');
  await page.fill('input[name=email]', 'ada@example.com');
  await page.click('button[type=submit]:has-text("Save")');
  await expect(page.getByRole('cell', { name: 'ada@example.com' })).toBeVisible();
});

test('creates a credential without exposing the secret', async ({ page }) => {
  await login(page);
  await page.goto('/credentials');
  await page.click('button:has-text("New credential")');
  await page.selectOption('select', 'httpBearerAuth');
  await page.locator('input[placeholder="Bearer Token"]').fill(`E2E token ${Date.now()}`);
  await page.locator('input[type=password]').fill('e2e-secret-value-123');
  await page.click('button:has-text("Create credential")');
  await expect(page.getByText('Credential created')).toBeVisible();
  await expect(page.getByText('e2e-secret-value-123')).toHaveCount(0);
});
