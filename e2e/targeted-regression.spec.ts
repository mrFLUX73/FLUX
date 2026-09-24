import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { collectRuntime, expectNoHorizontalOverflow, openApp, settleUi, signedInPage, stableScreenshot, statePath } from './helpers';

const baseUrl = process.env.FLUX_E2E_BASE_URL ?? 'http://127.0.0.1:4179';
const clientName = 'Илья Северин';
const nutritionOnSeptember14 = [
  ['Овсянка', '60 г', '220 ккал'], ['Кефир', '200 г', '106 ккал'],
  ['Куриное филе', '160 г', '264 ккал'], ['Рис', '150 г', '195 ккал'],
] as const;

async function pageFor(browser: import('@playwright/test').Browser, persona: 'CLIENT' | 'TRAINER' | 'EMPTY_CLIENT', width = 390): Promise<{ context: BrowserContext; page: Page; errors: () => string[] }> {
  const context = await browser.newContext({ storageState: statePath(persona), viewport: { width, height: 844 } });
  const page = await context.newPage();
  const errors = collectRuntime(page);
  await page.goto(baseUrl);
  await openApp(page);
  await settleUi(page);
  return { context, page, errors };
}

function overlaps(first: { x: number; y: number; width: number; height: number }, second: { x: number; y: number; width: number; height: number }) {
  return first.x < second.x + second.width && first.x + first.width > second.x && first.y < second.y + second.height && first.y + first.height > second.y;
}

function localIsoDay(daysAgo = 0) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

async function waitForHistoricalNutrition(page: Page) {
  // The selection render precedes its effect. Wait for the existing loader to
  // replace stale content before treating the selected day as stable.
  await page.waitForTimeout(50);
  await expect(page.locator('.flux-food-diary-content')).not.toHaveClass(/is-loading/);
  await expect(page.locator('.flux-meal-list .flux-section-heading h2')).toHaveText('Приёмы пищи');
}

test('targeted: trainer nutrition uses ISO date and keeps Nutrition open', async ({ browser }) => {
  const client = await pageFor(browser, 'CLIENT');
  await client.page.getByRole('button', { name: 'Питание', exact: true }).click();
  await settleUi(client.page);
  await client.page.locator('.flux-food-calendar > div > button').filter({ hasText: /\b14\b/ }).click();
  await settleUi(client.page);
  for (const [name, grams, kcal] of nutritionOnSeptember14) {
    const row = client.page.locator('.flux-meal-row').filter({ hasText: name });
    await expect(row).toContainText(grams); await expect(row).toContainText(kcal.replace(' ккал', ''));
  }
  await expect(client.page.locator('.flux-meal-row')).toHaveCount(4);
  await client.context.close();

  const trainer = await pageFor(browser, 'TRAINER');
  await trainer.page.getByRole('button', { name: 'Клиенты', exact: true }).click();
  const card = trainer.page.locator('.flux-client-card.is-active').filter({ hasText: clientName });
  await card.getByRole('button').first().click();
  await trainer.page.getByRole('button', { name: 'Питание', exact: true }).last().click();
  const day = trainer.page.locator('.flux-client-day-picker input');
  await day.fill('2026-09-14');
  await expect(day).toHaveValue('2026-09-14');
  await expect(trainer.page.locator('.flux-client-tabs button.is-active')).toHaveText('Питание');
  for (const [name, grams, kcal] of nutritionOnSeptember14) {
    const row = trainer.page.locator('.flux-client-meal').filter({ hasText: name });
    await expect(row).toContainText(grams); await expect(row).toContainText(kcal);
  }
  await expect(trainer.page.locator('.flux-client-meal')).toHaveCount(2);
  await expect(trainer.page.locator('.flux-client-goal-card')).toContainText('785');
  await expect(trainer.page.locator('.flux-client-goal-card')).toContainText('Б 67 · Ж 16 · У 86');
  await stableScreenshot(trainer.page, 'test-results/screenshots/targeted-trainer-nutrition-390.png');

  await day.fill('2026-09-12');
  await expect(day).toHaveValue('2026-09-12');
  await expect(trainer.page.locator('.flux-client-tabs button.is-active')).toHaveText('Питание');
  await expect(trainer.page.getByText('В этот день записей питания нет.', { exact: true })).toBeVisible();
  expect(trainer.errors()).toEqual([]);
  await trainer.context.close();
});

test('targeted: trainer hero remains intentional from 320 to 430', async ({ browser }) => {
  for (const width of [320, 375, 390, 430]) {
    const { context, page, errors } = await pageFor(browser, 'TRAINER', width);
    await page.getByRole('button', { name: 'Клиенты', exact: true }).click();
    await settleUi(page);
    const hero = page.locator('.flux-trainer-dashboard-hero');
    const title = hero.getByText('Мои клиенты', { exact: true });
    const cta = hero.getByRole('button', { name: 'Пригласить клиента', exact: true });
    const icon = hero.locator('.flux-rhythm-icon');
    await expect(title).toBeVisible(); await expect(cta).toBeVisible(); await expect(icon).toBeVisible();
    const [heroBox, titleBox, ctaBox, iconBox] = await Promise.all([hero.boundingBox(), title.boundingBox(), cta.boundingBox(), icon.boundingBox()]);
    expect(heroBox).not.toBeNull(); expect(titleBox).not.toBeNull(); expect(ctaBox).not.toBeNull(); expect(iconBox).not.toBeNull();
    expect(overlaps(titleBox!, ctaBox!)).toBe(false);
    expect(ctaBox!.x).toBeGreaterThanOrEqual(heroBox!.x); expect(ctaBox!.x + ctaBox!.width).toBeLessThanOrEqual(heroBox!.x + heroBox!.width + 1);
    expect(iconBox!.x).toBeGreaterThanOrEqual(heroBox!.x); expect(iconBox!.width).toBe(48);
    if (width === 320) expect(ctaBox!.y).toBeGreaterThan(titleBox!.y + titleBox!.height - 1);
    await expectNoHorizontalOverflow(page);
    await stableScreenshot(page, `test-results/screenshots/targeted-trainer-hero-${width}.png`);
    expect(errors()).toEqual([]);
    await context.close();
  }
});

test('targeted: Today slogan stays available at mobile widths', async ({ browser }) => {
  for (const [persona, widths] of [['CLIENT', [320, 375, 390, 430]], ['EMPTY_CLIENT', [320, 390]]] as const) {
    for (const width of widths) {
      const { context, page, errors } = await pageFor(browser, persona, width);
      const title = page.locator('.flux-home-title');
      const avatar = page.locator('.flux-avatar');
      const messenger = page.locator('.flux-messages-button');
      await expect(title.locator('span').nth(0)).toHaveText('Сегодня достаточно');
      await expect(title.locator('span').nth(1)).toHaveText('просто продолжить.');
      const [titleBox, avatarBox, messengerBox, textBoxes, spansFit] = await Promise.all([
        title.boundingBox(), avatar.boundingBox(), messenger.boundingBox(),
        title.locator('span').evaluateAll((spans) => spans.map((span) => {
          const rect = span.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })),
        title.locator('span').evaluateAll((spans) => spans.every((span) => span.scrollWidth <= span.clientWidth + 1)),
      ]);
      expect(titleBox).not.toBeNull(); expect(avatarBox).not.toBeNull(); expect(messengerBox).not.toBeNull();
      expect(spansFit).toBe(true);
      expect(overlaps(titleBox!, avatarBox!)).toBe(false);
      expect(textBoxes.every((box) => !overlaps(box, messengerBox!))).toBe(true);
      await expectNoHorizontalOverflow(page);
      await stableScreenshot(page, `test-results/screenshots/targeted-${persona.toLowerCase()}-today-${width}.png`);
      expect(errors()).toEqual([]);
      await context.close();
    }
  }
});

test('targeted: Nutrition saves add and repeat in the selected local day', async ({ browser }) => {
  const { context, page } = await signedInPage(browser, 'CLIENT');
  const errors = collectRuntime(page);
  await openApp(page); await settleUi(page);
  const today = localIsoDay();
  const yesterday = localIsoDay(1);
  const fixtureDay = '2026-09-14';
  const dayAfterFixture = '2026-09-15';
  const picker = page.getByLabel('Выбрать дату питания');

  await page.getByRole('button', { name: 'Питание', exact: true }).click();
  const todayEggCount = await page.locator('.flux-meal-row').filter({ hasText: 'Яйцо куриное' }).count();
  await expect(picker).toHaveValue(today);
  await expect(page.getByLabel('Показать следующий день')).toBeDisabled();
  await page.getByRole('button', { name: 'Что вы съели?' }).click();
  await page.locator('.flux-product-row').filter({ hasText: 'Яйцо куриное' }).first().click();
  await page.getByRole('button', { name: /Добавить в / }).click();
  await expect(page.locator('.flux-drawer')).toHaveCount(0);
  const todayEggRows = page.locator('.flux-meal-row').filter({ hasText: 'Яйцо куриное' });
  await expect(todayEggRows).toHaveCount(todayEggCount + 1);
  await todayEggRows.last().getByLabel('Удалить Яйцо куриное').click();
  await expect(todayEggRows).toHaveCount(todayEggCount);
  await page.getByLabel('Показать предыдущий день').click();
  await expect(picker).toHaveValue(yesterday);
  await page.getByLabel('Показать следующий день').click();
  await expect(picker).toHaveValue(today);
  await picker.fill(fixtureDay);
  await expect(picker).toHaveValue(fixtureDay);
  await picker.fill(localIsoDay(-1));
  await expect(picker).toHaveValue(fixtureDay);
  await waitForHistoricalNutrition(page);

  await page.getByRole('button', { name: 'Что вы съели?' }).click();
  await page.locator('.flux-product-row').filter({ hasText: 'Яйцо куриное' }).first().click();
  await page.getByRole('button', { name: /Добавить в / }).click();
  await expect(page.locator('.flux-drawer')).toHaveCount(0);
  const eggRows = page.locator('.flux-meal-row').filter({ hasText: 'Яйцо куриное' });
  await expect(eggRows).toHaveCount(1);

  await page.reload(); await openApp(page); await settleUi(page);
  await page.getByRole('button', { name: 'Питание', exact: true }).click();
  await page.getByLabel('Выбрать дату питания').fill(fixtureDay);
  await waitForHistoricalNutrition(page);
  await expect(eggRows).toHaveCount(1);

  await eggRows.getByLabel('Изменить Яйцо куриное').click();
  const editDrawer = page.getByRole('dialog');
  await editDrawer.getByLabel('Количество, г').fill('120');
  await editDrawer.getByRole('button', { name: 'Перекус', exact: true }).click();
  await editDrawer.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await expect(eggRows).toContainText('120 г');

  await page.getByLabel('Повторить предыдущий перекус').click();
  const repeatDrawer = page.getByRole('dialog');
  await repeatDrawer.locator('.flux-repeat-history-row').filter({ hasText: 'Яйцо куриное' }).click();
  await repeatDrawer.getByRole('button', { name: 'Повторить приём пищи', exact: true }).click();
  await expect(page.locator('.flux-drawer')).toHaveCount(0);
  await expect(eggRows).toHaveCount(2);

  await page.getByLabel('Выбрать дату питания').fill(today);
  await expect(eggRows).toHaveCount(todayEggCount);
  await page.getByLabel('Выбрать дату питания').fill(fixtureDay);
  await waitForHistoricalNutrition(page);
  await expect(eggRows).toHaveCount(2);
  while (await eggRows.count()) {
    const before = await eggRows.count();
    await eggRows.first().getByLabel('Удалить Яйцо куриное').click();
    await expect(eggRows).toHaveCount(before - 1);
  }

  await page.route('**/functions/v1/product-search', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { mode?: string };
    if (body.mode === 'name-search') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'found', candidates: [{ source: 'nutriapix', name: 'E2E Nutriapix вчера', brand: 'FLUX test', slug: 'e2e-nutrition-yesterday' }] }) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'found', product: { id: 'nutriapix:e2e-nutrition-yesterday', name: 'E2E Nutriapix вчера', brand: 'FLUX test', amount: 100, unit: 'г', servingSizeG: 100, kcal: 90, protein: 3, fat: 2, carbs: 14, icon: 'curd', source: 'nutriapix', externalFoodId: '1234567890123456789012345', externalBrandId: 'e2e-brand', externalServingId: 'e2e-serving' } }) });
  });
  await page.getByRole('button', { name: 'Что вы съели?' }).click();
  await page.getByLabel('Найти продукт, бренд или штрихкод').fill('nutri');
  await page.locator('.flux-product-row').filter({ hasText: 'E2E Nutriapix вчера' }).click();
  const externalAddResponse = page.waitForResponse((response) => response.url().includes('/rpc/add_external_meal_item'));
  await page.getByRole('button', { name: /Добавить в / }).click();
  expect((await externalAddResponse).status()).toBe(200);
  await expect(page.locator('.flux-drawer')).toHaveCount(0);
  const externalRows = page.locator('.flux-meal-row').filter({ hasText: 'E2E Nutriapix вчера' });
  await expect(externalRows).toHaveCount(1);

  await page.reload(); await openApp(page); await settleUi(page);
  await page.getByRole('button', { name: 'Питание', exact: true }).click();
  await page.getByLabel('Выбрать дату питания').fill(fixtureDay);
  await waitForHistoricalNutrition(page);
  await expect(externalRows).toHaveCount(1);
  await page.getByLabel('Выбрать дату питания').fill(today);
  await expect(externalRows).toHaveCount(0);
  await page.getByLabel('Выбрать дату питания').fill(fixtureDay);
  await waitForHistoricalNutrition(page);
  await externalRows.getByLabel('Удалить E2E Nutriapix вчера').click();
  await expect(externalRows).toHaveCount(0);

  await page.locator('.flux-content').evaluate((node) => {
    const touch = (type: string, x: number, y: number) => {
      const point = new Touch({ identifier: 1, target: node, clientX: x, clientY: y });
      node.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [point], changedTouches: [point] }));
    };
    touch('touchstart', 240, 300); touch('touchmove', 160, 304); touch('touchend', 160, 304);
  });
  await expect(page.getByLabel('Выбрать дату питания')).toHaveValue(dayAfterFixture);
  await page.locator('.flux-content').evaluate((node) => {
    const touch = (type: string, x: number, y: number) => {
      const point = new Touch({ identifier: 1, target: node, clientX: x, clientY: y });
      node.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [point], changedTouches: [point] }));
    };
    touch('touchstart', 160, 304); touch('touchmove', 240, 304); touch('touchend', 240, 304);
  });
  await expect(page.getByLabel('Выбрать дату питания')).toHaveValue(fixtureDay);
  await page.locator('.flux-content').evaluate((node) => {
    const touch = (type: string, x: number, y: number) => {
      const point = new Touch({ identifier: 1, target: node, clientX: x, clientY: y });
      node.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [point], changedTouches: [point] }));
    };
    touch('touchstart', 180, 220); touch('touchmove', 182, 330); touch('touchend', 182, 330);
  });
  await expect(page.getByLabel('Выбрать дату питания')).toHaveValue(fixtureDay);
  expect(errors()).toEqual([]);
  await context.close();
});

test('targeted: Nutrition keeps stale content stable until the selected day is ready', async ({ browser }) => {
  const { context, page } = await signedInPage(browser, 'CLIENT', 320);
  const errors = collectRuntime(page);
  await openApp(page); await settleUi(page);
  const picker = page.getByLabel('Выбрать дату питания');
  const dayWithEntries = localIsoDay(1);
  const emptyDay = localIsoDay(2);
  const intermediateDay = localIsoDay(3);
  const oatmealRows = page.locator('.flux-meal-row').filter({ hasText: 'Овсянка' });
  const diaryContent = page.locator('.flux-food-diary-content');
  let delayRequests = false;
  let releaseRequests = () => undefined;
  let pendingRequests = Promise.resolve();
  const holdMealRequests = () => {
    delayRequests = true;
    pendingRequests = new Promise<void>((resolve) => { releaseRequests = resolve; });
  };
  await page.route('**/rest/v1/meals*', async (route) => {
    if (delayRequests) await pendingRequests;
    await route.continue();
  });

  await page.getByRole('button', { name: 'Питание', exact: true }).click();
  await picker.fill(dayWithEntries);
  await waitForHistoricalNutrition(page);
  await expect(oatmealRows).toHaveCount(1);

  holdMealRequests();
  await picker.fill(emptyDay);
  await expect(picker).toHaveValue(emptyDay);
  await expect(page.getByLabel('Загружаем выбранный день')).toBeVisible();
  await expect(diaryContent).toHaveClass(/is-loading/);
  await expect(page.getByRole('heading', { name: 'Приёмы пищи', exact: true })).toBeVisible();
  await expect(page.getByText('Загружаем день…', { exact: true })).toHaveCount(0);
  await expect(oatmealRows).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Что вы съели?' })).toBeDisabled();
  await stableScreenshot(page, 'test-results/screenshots/targeted-nutrition-stale-transition-loading-320.png');
  releaseRequests();
  delayRequests = false;
  await waitForHistoricalNutrition(page);
  await expect(oatmealRows).toHaveCount(0);
  await expect(page.getByText('Дневник пока пуст', { exact: true })).toBeVisible();

  await picker.fill(dayWithEntries);
  await waitForHistoricalNutrition(page);
  await expect(oatmealRows).toHaveCount(1);

  holdMealRequests();
  await picker.fill(intermediateDay);
  await picker.fill(dayWithEntries);
  await expect(picker).toHaveValue(dayWithEntries);
  await expect(oatmealRows).toHaveCount(1);
  releaseRequests();
  delayRequests = false;
  await waitForHistoricalNutrition(page);
  await expect(oatmealRows).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
  await stableScreenshot(page, 'test-results/screenshots/targeted-nutrition-stale-transition-320.png');
  expect(errors()).toEqual([]);
  await context.close();
});

test('targeted: Nutrition date navigation fits from 320 to 430', async ({ browser }) => {
  for (const width of [320, 375, 390, 430]) {
    const { context, page, errors } = await pageFor(browser, 'EMPTY_CLIENT', width);
    await page.getByRole('button', { name: 'Питание', exact: true }).click();
    await expect(page.locator('.flux-food-day-nav')).toBeVisible();
    await expect(page.getByLabel('Выбрать дату питания')).toBeVisible();
    await expect(page.getByLabel('Показать предыдущий день')).toBeVisible();
    await expect(page.getByLabel('Показать следующий день')).toBeDisabled();
    await expectNoHorizontalOverflow(page);
    await stableScreenshot(page, `test-results/screenshots/targeted-nutrition-date-nav-${width}.png`);
    expect(errors().filter((error) => !error.includes('status of 400'))).toEqual([]);
    await context.close();
  }
});
