import { expect, test } from '@playwright/test';
import { collectRuntime, expectNoHorizontalOverflow, fixtureSession, openApp, signedInPage } from './helpers';

const clientName = 'Илья Северин';

test('Test Client: production bundle opens core screens without runtime or layout failures', async ({ browser }) => {
  const { context, page } = await signedInPage(browser, 'CLIENT'); const runtime = collectRuntime(page);
  await openApp(page);
  for (const [label, heading] of [['Сегодня', 'Сегодня достаточно просто продолжить.'], ['Питание', 'Питание'], ['Тренировки', 'Тренировки'], ['Прогресс', 'Прогресс']] as const) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
  await page.getByLabel('Открыть мой профиль').click();
  await expect(page.getByText('Данные для точного расчёта')).toBeVisible();
  await page.getByLabel('Сообщения').click();
  await expect(page.getByRole('heading', { name: 'Сообщения' })).toBeVisible();
  expect(runtime()).toEqual([]);
  await context.close();
});

test('Test Trainer: active client workspace, notes and Messenger remain available', async ({ browser }) => {
  const { context, page } = await signedInPage(browser, 'TRAINER'); const runtime = collectRuntime(page);
  await openApp(page);
  await page.getByRole('button', { name: 'Клиенты', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Клиенты', exact: true })).toBeVisible();
  await expect(page.getByText(clientName, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: clientName, exact: true }).click();
  await expect(page.getByText('Приватные заметки')).toBeVisible();
  for (const label of ['Питание', 'Тренировки', 'Прогресс']) {
    await page.getByRole('button', { name: label, exact: true }).last().click();
    await expectNoHorizontalOverflow(page);
  }
  await page.getByLabel('Назад к клиентам').click();
  await page.getByLabel('Сообщения').click();
  await expect(page.getByText(clientName, { exact: true })).toBeVisible();
  expect(runtime()).toEqual([]);
  await context.close();
});

test('Empty Client: empty states do not render crashes or raw null values', async ({ browser }) => {
  const { context, page } = await signedInPage(browser, 'EMPTY_CLIENT'); const runtime = collectRuntime(page);
  await openApp(page);
  for (const [label, heading] of [['Сегодня', 'Сегодня достаточно просто продолжить.'], ['Питание', 'Питание'], ['Тренировки', 'Тренировки'], ['Прогресс', 'Прогресс']] as const) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/\b(undefined|NaN|null)\b/);
    await expectNoHorizontalOverflow(page);
  }
  expect(runtime()).toEqual([]);
  await context.close();
});

test('Other Trainer cannot obtain Test Client trainer-only facts', async () => {
  const session = await fixtureSession('OTHER_TRAINER');
  const url = process.env.VITE_SUPABASE_URL!; const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
  const response = await fetch(`${url}/rest/v1/rpc/get_trainer_client_overview`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_client_id: '00000000-0000-0000-0000-000000000000' }),
  });
  expect(response.ok).toBe(false);
  expect([401, 403, 404]).toContain(response.status);
});

test('critical client and trainer screens do not overflow at mobile widths', async ({ browser }) => {
  for (const [persona, screen] of [['CLIENT', 'Питание'], ['TRAINER', 'Клиенты']] as const) {
    for (const width of [320, 375, 390, 430]) {
      const { context, page } = await signedInPage(browser, persona, width);
      await openApp(page); await page.getByRole('button', { name: screen, exact: true }).click();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `test-results/screenshots/${persona.toLowerCase()}-${width}.png`, fullPage: true });
      await context.close();
    }
  }
});
