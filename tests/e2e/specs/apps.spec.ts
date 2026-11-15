import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('builds an app with drag and drop, wires an event and publishes it', async ({ page }) => {
  await login(page);
  await page.goto('/apps');
  await page.getByRole('button', { name: /New app|Create your first app/ }).first().click();
  await page.locator('div[role=dialog] button:has-text("Blank app")').click();
  await page.fill('div[role=dialog] input', `E2E app ${Date.now()}`);
  await page.click('div[role=dialog] button:has-text("Create app")');
  await expect(page).toHaveURL(/\/apps\/[a-z0-9]+$/);
  await expect(page.locator('.sai-page')).toBeVisible();

  // drag a button from the palette onto the page
  await page.dragAndDrop('button[title^="Clickable button"]', '.sai-page', { targetPosition: { x: 200, y: 160 } });
  await expect(page.locator('.sai-page .sai-btn')).toHaveCount(1);
  await page.locator('div.space-y-1:has(> div:text-is("Label")) input').first().fill('Say hello');
  await expect(page.locator('.sai-page .sai-btn')).toHaveText('Say hello');

  // style it and wire a notification
  await page.click('button:text-is("style")');
  await page.click('button:has-text("Effects")');
  await page.click('button:text-is("Glow")');
  await page.click('button:text-is("events")');
  await page.click('button:has-text("Add action")');
  await page.click('button:has-text("Show notification")');
  await page.locator('div.space-y-1:has(> div:text-is("Message")) input').first().fill('Hello from {{ app.name }}');

  // preview runs the event
  await page.click('button:has-text("Preview")');
  await page.click('.sai-btn:has-text("Say hello")');
  await expect(page.getByText(/Hello from E2E app/)).toBeVisible();
  await page.click('button:has-text("Edit")');

  // wait for autosave
  await expect(page.getByText('Saved')).toBeVisible({ timeout: 15_000 });

  // publish and open the live app
  await page.click('header button:has-text("Publish")');
  await page.click('div[role=dialog] button:has-text("Publish")');
  await expect(page.getByText(/Version 1 is live/)).toBeVisible();
  const href = await page.locator('div[role=dialog] a:has-text("Open")').getAttribute('href');
  await page.goto(href!);
  await expect(page.locator('.sai-btn:has-text("Say hello")')).toBeVisible();
});

test('demo Lead Manager app reads and writes the Leads data table', async ({ page }) => {
  await login(page);
  await page.goto('/a/lead-manager-demo');
  await expect(page.locator('.sai-table tbody tr').first()).toBeVisible();
  const name = `E2E Lead ${Date.now()}`;
  await page.click('.sai-btn:has-text("New lead")');
  await page.click('.sai-modal button[type=submit]');
  await expect(page.getByText(/Please fill in/)).toBeVisible();
  await page.fill('.sai-modal input[placeholder="Jane Doe"]', name);
  await page.fill('.sai-modal input[placeholder="jane@company.com"]', 'e2e@example.com');
  await page.click('.sai-modal button[type=submit]');
  await page.fill('input[placeholder^="Search name"]', name);
  await expect(page.locator('.sai-table tbody tr')).toHaveCount(1);
  await page.click(`.sai-table tbody tr:has-text("${name}")`);
  await page.click('.sai-modal .sai-btn:has-text("Score with workflow")');
  await expect(page.locator('.sai-modal .sai-alert')).toContainText(/score \d+/, { timeout: 30_000 });
  page.once('dialog', (d) => d.accept());
  await page.click('.sai-modal .sai-btn:has-text("Delete")');
  await expect(page.getByText('Lead deleted')).toBeVisible();
});
