import { expect, test } from '@playwright/test';
import { openApp, statePath } from './helpers';

const clientName = 'Илья Северин';
const baseUrl = process.env.FLUX_E2E_BASE_URL ?? 'http://127.0.0.1:4179';

test('stored Test Client state opens authenticated Today', async ({ browser }) => {
  const context = await browser.newContext({ storageState: statePath('CLIENT'), viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(baseUrl);
  await openApp(page);
  await expect(page.getByRole('heading', { name: 'Сегодня достаточно просто продолжить.', exact: true })).toBeVisible();
  await context.close();
});

test('stored Test Trainer state reaches Test Client workspace', async ({ browser }) => {
  const context = await browser.newContext({ storageState: statePath('TRAINER'), viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(baseUrl);
  await openApp(page);
  await page.getByRole('button', { name: 'Клиенты', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Клиенты', exact: true })).toBeVisible();
  await expect(page.getByText(clientName, { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/screenshots/test-trainer-clients.png', fullPage: true });
  await page.locator('article').filter({ hasText: clientName }).getByRole('button').first().click();
  await expect(page.getByText('Приватные заметки', { exact: true })).toBeVisible();
  await context.close();
});

test('stored Empty Client state opens authenticated empty Today', async ({ browser }) => {
  const context = await browser.newContext({ storageState: statePath('EMPTY_CLIENT'), viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(baseUrl);
  await openApp(page);
  await expect(page.getByRole('heading', { name: 'Сегодня достаточно просто продолжить.', exact: true })).toBeVisible();
  await context.close();
});

test('stored Other Trainer state does not receive Test Client', async ({ browser }) => {
  const context = await browser.newContext({ storageState: statePath('OTHER_TRAINER'), viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(baseUrl);
  await openApp(page);
  await page.getByRole('button', { name: 'Клиенты', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Клиенты', exact: true })).toBeVisible();
  await expect(page.getByText(clientName, { exact: true })).toHaveCount(0);
  await context.close();
});
