import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('builds, saves and executes a workflow in the editor', async ({ page }) => {
  await login(page);
  await page.goto('/workflows');
  await page.click('button:has-text("New workflow")');
  await expect(page).toHaveURL(/\/workflows\/[a-z0-9]+$/);
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  // add a Set Variables node from the palette (connects to the selected node)
  await page.locator('.react-flow__node').first().click();
  await page.fill('input[placeholder="Search nodes…"]', 'Set Variables');
  await page.locator('aside button:has-text("Set Variables")').first().click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.fill('input[aria-label="Workflow name"]', `E2E workflow ${Date.now()}`);
  await page.click('button:has-text("Save")');
  await expect(page.getByText('Workflow saved')).toBeVisible();
  await page.click('button:has-text("Execute")');
  await expect(page.getByText('Execution finished successfully')).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
});

test('runs the demo order workflow and inspects the execution', async ({ page }) => {
  await login(page);
  await page.goto('/workflows');
  await page.click('text=Order Processing (demo)');
  await page.click('button:has-text("Execute")');
  await expect(page.getByText('Execution finished successfully')).toBeVisible({ timeout: 30_000 });
  await page.click('a:has-text("Details")');
  await expect(page).toHaveURL(/\/executions\//);
  await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
  await expect(page.getByText('Compute Totals').first()).toBeVisible();
});

test('installs a template', async ({ page }) => {
  await login(page);
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Use template' }).first().click();
  await expect(page).toHaveURL(/\/workflows\/[a-z0-9]+$/);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
});
