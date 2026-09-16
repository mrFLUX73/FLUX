import { createClient } from '@supabase/supabase-js';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { collectRuntime, expectNoHorizontalOverflow, openApp, settleUi, stableScreenshot, statePath, storedSessionRpcStatus } from './helpers';

const baseUrl = process.env.FLUX_E2E_BASE_URL ?? 'http://127.0.0.1:4179';
const clientName = 'Илья Северин';

async function pageFor(browser: import('@playwright/test').Browser, persona: 'CLIENT' | 'TRAINER' | 'EMPTY_CLIENT' | 'OTHER_TRAINER', width = 390): Promise<{ context: BrowserContext; page: Page; errors: () => string[] }> {
  const context = await browser.newContext({ storageState: statePath(persona), viewport: { width, height: 844 } });
  const page = await context.newPage();
  const errors = collectRuntime(page);
  await page.goto(baseUrl);
  await openApp(page);
  await settleUi(page);
  return { context, page, errors };
}

async function expectNoRawValues(page: Page) {
  await expect(page.locator('body')).not.toContainText(/\b(undefined|NaN|null)\b/);
}

test('Test Client: core product smoke', async ({ browser }) => {
  const { context, page, errors } = await pageFor(browser, 'CLIENT');
  await expect(page.getByText('Доброе утро, Илья', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Изменить дневной баланс')).toBeVisible();
  await expect(page.getByText('Ваш тренер', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
  await expectNoRawValues(page); await expectNoHorizontalOverflow(page);
  await stableScreenshot(page, 'test-results/screenshots/smoke-client-today-390.png');

  await page.getByRole('button', { name: 'Питание', exact: true }).click(); await settleUi(page);
  await expect(page.getByRole('heading', { name: 'Питание', exact: true })).toBeVisible();
  await expect(page.locator('.flux-meal-row, .flux-diary-empty')).not.toHaveCount(0);
  await expectNoRawValues(page); await expectNoHorizontalOverflow(page);
  await stableScreenshot(page, 'test-results/screenshots/smoke-client-food-390.png');
  const dates = page.locator('.flux-food-calendar > div > button');
  const selected = await dates.evaluateAll((nodes) => nodes.findIndex((node) => node.getAttribute('aria-pressed') === 'true'));
  expect(selected).toBeGreaterThanOrEqual(2);
  await dates.nth(selected - 1).click(); await settleUi(page);
  await expect(page.getByText(/^История за /)).toBeVisible();
  await page.getByRole('button', { name: 'Показать предыдущую неделю' }).click(); await settleUi(page);
  await page.locator('.flux-food-calendar > div > button').last().click(); await settleUi(page);
  await expect(page.getByText('Дневник пока пуст', { exact: true })).toBeVisible();
  await expectNoRawValues(page);

  await page.getByRole('button', { name: 'Тренировки', exact: true }).click(); await settleUi(page);
  await expect(page.getByRole('heading', { name: 'Тренировки', exact: true })).toBeVisible();
  await expect(page.getByText('Мои планы', { exact: true })).toBeVisible();
  await expect(page.getByLabel('История тренировок')).toBeVisible();
  await expectNoRawValues(page); await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Прогресс', exact: true }).click(); await settleUi(page);
  await expect(page.getByRole('heading', { name: 'Прогресс', exact: true })).toBeVisible();
  await expect(page.getByText('Эта неделя', { exact: true })).toBeVisible();
  await expectNoRawValues(page); await expectNoHorizontalOverflow(page);

  await page.getByLabel('Открыть мой профиль').click(); await settleUi(page);
  await expect(page.getByText('Данные для точного расчёта', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Роль / }).click(); await settleUi(page);
  await expect(page.getByText('Мой тренер', { exact: true })).toBeVisible();
  await stableScreenshot(page, 'test-results/screenshots/smoke-client-profile-390.png');
  await page.getByLabel('Показать версию приложения').click(); await settleUi(page);
  await expect(page.getByText('Что нового в FLUX', { exact: true })).toBeVisible();
  await page.getByText('Полный список изменений', { exact: true }).click(); await settleUi(page);
  await expect(page.getByText(/^Что нового в #/)).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByLabel('Закрыть профиль').click(); await settleUi(page);

  await page.getByLabel(/Сообщения|Новые сообщения/).click(); await settleUi(page);
  await expect(page.getByRole('heading', { name: 'Сообщения', exact: true })).toBeVisible();
  await expect(page.locator('.flux-messenger-chat-card')).not.toHaveCount(0);
  await page.locator('.flux-messenger-chat-card').first().click(); await settleUi(page);
  await expect(page.getByPlaceholder('Написать сообщение…')).toBeVisible();
  expect(errors()).toEqual([]);
  await context.close();
});

test('Test Trainer: clients, workspace, notes and Messenger smoke', async ({ browser }) => {
  const { context, page, errors } = await pageFor(browser, 'TRAINER');
  await page.getByRole('button', { name: 'Клиенты', exact: true }).click(); await settleUi(page);
  await expect(page.getByRole('heading', { name: 'Клиенты', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Пригласить клиента', exact: true })).toBeVisible();
  const card = page.locator('.flux-client-card').filter({ hasText: clientName });
  await expect(card).toHaveCount(1);
  await expect(card.getByLabel(`Написать ${clientName}`)).toBeVisible();
  await expect(card.getByLabel(`Действия для ${clientName}`)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await stableScreenshot(page, 'test-results/screenshots/smoke-trainer-clients-390.png');
  await card.getByRole('button').first().click(); await settleUi(page);
  await expect(page.getByText('Цель клиента', { exact: true })).toBeVisible();
  await expect(page.getByText('Приватные заметки', { exact: true })).toBeVisible();
  await expect(page.locator('.flux-trainer-notes-list article')).not.toHaveCount(0);
  await expectNoRawValues(page); await expectNoHorizontalOverflow(page);
  await stableScreenshot(page, 'test-results/screenshots/smoke-trainer-workspace-overview-390.png');

  await page.getByRole('button', { name: 'Питание', exact: true }).last().click(); await settleUi(page);
  await expect(page.getByText('Рацион за день', { exact: true })).toBeVisible();
  await expect(page.locator('.flux-client-meal, .flux-trainer-empty')).not.toHaveCount(0);
  await stableScreenshot(page, 'test-results/screenshots/smoke-trainer-workspace-food-390.png');
  const day = page.locator('.flux-client-day-picker input');
  await day.fill('2026-09-14'); await settleUi(page);
  console.log(`FLUX_TRAINER_NUTRITION_2026_09_14_MEALS ${await page.locator('.flux-client-meal').count()}`);

  await page.getByRole('button', { name: 'Тренировки', exact: true }).last().click(); await settleUi(page);
  await expect(page.getByText('Текущий план клиента', { exact: true })).toBeVisible();
  await expect(page.getByText('История', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Прогресс', exact: true }).last().click(); await settleUi(page);
  await expect(page.getByText('История прогресса появится здесь', { exact: true })).toBeVisible();
  await page.getByLabel('Назад к клиентам').click(); await settleUi(page);
  await card.getByLabel(`Написать ${clientName}`).click(); await settleUi(page);
  await expect(page.getByPlaceholder('Написать сообщение…')).toBeVisible();
  expect(errors()).toEqual([]);
  await context.close();
});

test('Empty Client: missing data stays a product empty state', async ({ browser }) => {
  const { context, page, errors } = await pageFor(browser, 'EMPTY_CLIENT');
  for (const [label, heading] of [['Сегодня', 'Сегодня достаточно просто продолжить.'], ['Питание', 'Питание'], ['Тренировки', 'Тренировки'], ['Прогресс', 'Прогресс']] as const) {
    await page.getByRole('button', { name: label, exact: true }).click(); await settleUi(page);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expectNoRawValues(page); await expectNoHorizontalOverflow(page);
  }
  await page.getByRole('button', { name: 'Сегодня', exact: true }).click(); await settleUi(page);
  await stableScreenshot(page, 'test-results/screenshots/smoke-empty-client-today-390.png');
  await page.getByLabel('Открыть мой профиль').click(); await settleUi(page);
  await expect(page.getByText('Данные для точного расчёта', { exact: true })).toBeVisible();
  expect(errors()).toEqual([]);
  await context.close();
});

test('Other Trainer: UI and RPC isolation from Test Client', async ({ browser }) => {
  const { context, page, errors } = await pageFor(browser, 'OTHER_TRAINER');
  await page.getByRole('button', { name: 'Клиенты', exact: true }).click(); await settleUi(page);
  await expect(page.getByRole('heading', { name: 'Клиенты', exact: true })).toBeVisible();
  await expect(page.getByText(clientName, { exact: true })).toHaveCount(0);
  const url = process.env.VITE_SUPABASE_URL!;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: record, error: accountError } = await admin.from('test_accounts').select('user_id').eq('purpose', 'client').single();
  expect(accountError).toBeNull(); expect(record?.user_id).toBeTruthy();
  const denied = await storedSessionRpcStatus(page, 'get_trainer_client_overview', { p_client_id: record!.user_id });
  expect(denied.authenticated).toBe(true);
  expect([401, 403, 404]).toContain(denied.status);
  expect(errors().filter((error) => !error.includes('status of 403'))).toEqual([]);
  await context.close();
});

async function verifyResponsiveCriticalScreens(browser: import('@playwright/test').Browser, widths: number[]) {
  for (const width of widths) {
    const client = await pageFor(browser, 'CLIENT', width);
    for (const label of ['Сегодня', 'Питание'] as const) { await client.page.getByRole('button', { name: label, exact: true }).click(); await settleUi(client.page); await expectNoHorizontalOverflow(client.page); }
    await client.page.getByLabel('Открыть мой профиль').click(); await settleUi(client.page); await expectNoHorizontalOverflow(client.page);
    await client.context.close();

    const trainer = await pageFor(browser, 'TRAINER', width);
    await trainer.page.getByRole('button', { name: 'Клиенты', exact: true }).click(); await settleUi(trainer.page);
    const card = trainer.page.locator('.flux-client-card').filter({ hasText: clientName });
    await expect(card).toHaveCount(1); await expectNoHorizontalOverflow(trainer.page);
    const measurements = await card.evaluate((element) => {
      const main = element.querySelector('.flux-client-card-main')!.getBoundingClientRect();
      const actions = [...element.querySelectorAll('.flux-client-card-actions > button')].map((button) => button.getBoundingClientRect());
      return { main, actions };
    });
    expect(measurements.actions).toHaveLength(2);
    expect(measurements.actions.every((action) => Math.abs((action.top + action.bottom) / 2 - (measurements.main.top + measurements.main.bottom) / 2) < 2)).toBe(true);
    await expect(trainer.page.getByRole('button', { name: 'Пригласить клиента', exact: true })).toBeVisible();
    if (width === 320 || width === 390) await stableScreenshot(trainer.page, `test-results/screenshots/smoke-trainer-clients-${width}.png`);
    await card.getByRole('button').first().click(); await settleUi(trainer.page); await expectNoHorizontalOverflow(trainer.page);
    await trainer.page.getByRole('button', { name: 'Питание', exact: true }).last().click(); await settleUi(trainer.page); await expectNoHorizontalOverflow(trainer.page);
    await trainer.context.close();
  }
}

for (const width of [320, 375, 390, 430]) {
  test(`responsive: client and trainer critical screens fit ${width}px`, async ({ browser }) => {
    await verifyResponsiveCriticalScreens(browser, [width]);
  });
}
