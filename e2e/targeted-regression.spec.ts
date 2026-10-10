import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { authenticatedContext, collectRuntime, createNutritionFixtureScope, expectNoHorizontalOverflow, fixtureSession, openApp, settleUi, signedInPage, stableScreenshot } from './helpers';

const baseUrl = process.env.FLUX_E2E_BASE_URL ?? 'http://127.0.0.1:4179';
const nutritionClientName = 'Nutrition E2E';
const historicalNutritionDay = '2024-01-15';
const nutritionOnFixtureDay = [
  ['Овсянка', '60 г', '220 ккал'], ['Кефир', '200 г', '106 ккал'],
  ['Куриное филе', '160 г', '264 ккал'], ['Рис', '150 г', '195 ккал'],
] as const;

async function pageFor(browser: import('@playwright/test').Browser, persona: 'CLIENT' | 'TRAINER' | 'EMPTY_CLIENT' | 'NUTRITION_E2E_CLIENT', width = 390, mobile = false): Promise<{ context: BrowserContext; page: Page; userId: string; errors: () => string[] }> {
  const { context, page, userId } = await authenticatedContext(browser, persona, width, { mobile });
  const errors = collectRuntime(page);
  await page.goto(baseUrl);
  await openApp(page);
  await settleUi(page);
  return { context, page, userId, errors };
}

function overlaps(first: { x: number; y: number; width: number; height: number }, second: { x: number; y: number; width: number; height: number }) {
  return first.x < second.x + second.width && first.x + first.width > second.x && first.y < second.y + second.height && first.y + first.height > second.y;
}

async function expectPortionValueLayout(page: Page, unit: 'г' | 'мл' | 'шт', value: string) {
  const input = page.getByLabel(`Количество, ${unit}`);
  await input.fill(value);
  await expect(input).toHaveValue(value);
  const group = page.locator('.flux-portion-value');
  const [inputBox, unitBox, stepperBox, groupFits] = await Promise.all([
    input.boundingBox(),
    group.locator('span').boundingBox(),
    page.locator('.flux-portion-stepper').boundingBox(),
    group.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ]);
  expect(inputBox).not.toBeNull(); expect(unitBox).not.toBeNull(); expect(stepperBox).not.toBeNull();
  expect(unitBox!.x).toBeGreaterThan(inputBox!.x + inputBox!.width - 1);
  expect(Math.abs((inputBox!.y + inputBox!.height / 2) - (unitBox!.y + unitBox!.height / 2))).toBeLessThanOrEqual(2);
  expect(inputBox!.x).toBeGreaterThanOrEqual(stepperBox!.x);
  expect(unitBox!.x + unitBox!.width).toBeLessThanOrEqual(stepperBox!.x + stepperBox!.width + 1);
  expect(groupFits).toBe(true);
}

async function expectNutrientValuesOnOneLine(page: Page) {
  const metrics = page.locator('.flux-nutrient-grid > div');
  await expect(metrics).toHaveCount(4);

  for (const [index, expectedValue] of ['190ккал', '7г', '5г', '29г'].entries()) {
    const metric = metrics.nth(index);
    const value = metric.locator('.flux-nutrient-value');
    await expect(value).toHaveText(expectedValue);
    const [valueBox, numberBox, unitBox, geometry] = await Promise.all([
      value.boundingBox(),
      value.locator('strong').boundingBox(),
      value.locator('small').boundingBox(),
      value.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          display: style.display,
          flexWrap: style.flexWrap,
          fits: node.scrollWidth <= node.clientWidth + 1,
        };
      }),
    ]);
    expect(valueBox).not.toBeNull(); expect(numberBox).not.toBeNull(); expect(unitBox).not.toBeNull();
    // The value group is a grid item, so the browser blockifies inline-flex
    // to flex in computed styles. Its no-wrap flex layout is the invariant.
    expect(geometry.display).toBe('flex');
    expect(geometry.flexWrap).toBe('nowrap');
    expect(geometry.fits).toBe(true);
    expect(unitBox!.x).toBeGreaterThan(numberBox!.x + numberBox!.width - 1);
    expect(Math.max(numberBox!.y, unitBox!.y)).toBeLessThan(Math.min(numberBox!.y + numberBox!.height, unitBox!.y + unitBox!.height));
    expect(valueBox!.x).toBeGreaterThanOrEqual(0);
  }
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
  const client = await pageFor(browser, 'NUTRITION_E2E_CLIENT');
  const fixture = createNutritionFixtureScope(client.userId, 'Trainer nutrition');
  let trainer: Awaited<ReturnType<typeof pageFor>> | null = null;
  try {
    const products = [];
    for (const [name, values] of [
      ['Овсянка', { amount: 60, kcal: 219.6, protein: 7.2, carbs: 36, fat: 4.2 }],
      ['Кефир', { amount: 200, kcal: 106, protein: 6, carbs: 8, fat: 5 }],
      ['Куриное филе', { amount: 160, kcal: 264, protein: 49.6, carbs: 0, fat: 5.8 }],
      ['Рис', { amount: 150, kcal: 195, protein: 4.1, carbs: 42, fat: 0.5 }],
    ] as const) products.push(await fixture.createProduct(name, values));
    for (const [index, product] of products.entries()) {
      await fixture.seedEntry(product, { meal: index < 2 ? 'breakfast' : 'lunch', eatenAt: `2024-01-15T${String(8 + index).padStart(2, '0')}:00:00+04:00`, quantity: product.amount });
    }

    await client.page.getByRole('button', { name: 'Питание', exact: true }).click();
    await settleUi(client.page);
    await client.page.getByLabel('Выбрать дату питания').fill(historicalNutritionDay);
    await settleUi(client.page);
    for (const [name, grams, kcal] of nutritionOnFixtureDay) {
      const row = client.page.locator('.flux-meal-row').filter({ hasText: name });
      await expect(row).toContainText(grams); await expect(row).toContainText(kcal);
    }
    await expect(client.page.locator('.flux-meal-row')).toHaveCount(4);
    await client.context.close();

    trainer = await pageFor(browser, 'TRAINER');
    await trainer.page.getByRole('button', { name: 'Клиенты', exact: true }).click();
    const card = trainer.page.locator('.flux-client-card.is-active').filter({ hasText: nutritionClientName });
    await card.getByRole('button').first().click();
    await trainer.page.getByRole('button', { name: 'Питание', exact: true }).last().click();
    const day = trainer.page.locator('.flux-client-day-picker input');
    await day.fill(historicalNutritionDay);
    await expect(day).toHaveValue(historicalNutritionDay);
    await expect(trainer.page.locator('.flux-client-tabs button.is-active')).toHaveText('Питание');
    for (const [name, grams, kcal] of nutritionOnFixtureDay) {
      const row = trainer.page.locator('.flux-client-meal').filter({ hasText: name });
      await expect(row).toContainText(grams); await expect(row).toContainText(kcal);
    }
    await expect(trainer.page.locator('.flux-client-meal')).toHaveCount(4);
    await expect(trainer.page.locator('.flux-client-goal-card')).toContainText('785');
    await expect(trainer.page.locator('.flux-client-goal-card')).toContainText('Б 67 · Ж 16 · У 86');
    await stableScreenshot(trainer.page, 'test-results/screenshots/targeted-trainer-nutrition-390.png');

    await day.fill('2024-01-12');
    await expect(day).toHaveValue('2024-01-12');
    await expect(trainer.page.locator('.flux-client-tabs button.is-active')).toHaveText('Питание');
    await expect(trainer.page.getByText('В этот день записей питания нет.', { exact: true })).toBeVisible();
    expect(trainer.errors()).toEqual([]);
  } finally {
    if (trainer) await trainer.context.close();
    await fixture.cleanup();
    await client.context.close().catch(() => undefined);
  }
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
  test.setTimeout(120_000);
  const session = await fixtureSession('NUTRITION_E2E_CLIENT');
  const fixture = createNutritionFixtureScope(session.user.id, 'Diary mutations');
  let context: BrowserContext | null = null;
  try {
  const egg = await fixture.createProduct('Яйцо куриное', { amount: 120, kcal: 171.6, protein: 15.6, carbs: 1.2, fat: 12 });
  const authenticated = await authenticatedContext(browser, 'NUTRITION_E2E_CLIENT', 390, { mobile: true });
  context = authenticated.context;
  const { page } = authenticated;
  const errors = collectRuntime(page);
  await openApp(page); await settleUi(page);
  const today = localIsoDay();
  const yesterday = localIsoDay(1);
  const fixtureDay = historicalNutritionDay;
  const dayAfterFixture = '2024-01-16';
  const picker = page.getByLabel('Выбрать дату питания');

  await page.getByRole('button', { name: 'Питание', exact: true }).click();
  const todayEggCount = await page.locator('.flux-meal-row').filter({ hasText: egg.name }).count();
  const macroTexts = await page.locator('.flux-macro-grid strong').allTextContents();
  expect(macroTexts.every((text) => !/\d[,.]\d{2,}/.test(text))).toBe(true);
  const macroLabels = await page.locator('.flux-macro-grid [aria-label]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));
  expect(macroLabels.every((text) => !/\d[,.]\d{2,}/.test(text))).toBe(true);
  await expect(picker).toHaveValue(today);
  await expect(page.getByLabel('Показать следующий день')).toBeDisabled();
  let remoteDeleteCalls = 0;
  await page.route('**/rest/v1/rpc/delete_meal_item', async (route) => {
    remoteDeleteCalls += 1;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Что вы съели?' }).click();
  const localResult = page.locator('.flux-product-row').filter({ hasText: egg.name }).first();
  await expect(localResult).toContainText('ккал');
  await expect(localResult).toContainText('за ');
  await expect(localResult.locator('.flux-product-macro-preview')).toContainText(/^Белки .+ · Жиры .+ · Углеводы .+$/);
  await localResult.click();
  await page.getByRole('button', { name: /Добавить в / }).click();
  await expect(page.locator('.flux-drawer')).toHaveCount(0);
  const todayEggRows = page.locator('.flux-meal-row').filter({ hasText: egg.name });
  await expect(todayEggRows).toHaveCount(todayEggCount + 1);
  await todayEggRows.last().getByLabel(`Удалить ${egg.name}`).click();
  await expect(todayEggRows).toHaveCount(todayEggCount);
  await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeVisible();
  expect(remoteDeleteCalls).toBe(0);
  await page.getByLabel('Показать предыдущий день').click();
  await expect(picker).toHaveValue(yesterday);
  await page.getByLabel('Показать следующий день').click();
  await expect(picker).toHaveValue(today);
  await expect(todayEggRows).toHaveCount(todayEggCount);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(todayEggRows).toHaveCount(todayEggCount + 1);
  expect(remoteDeleteCalls).toBe(0);
  await todayEggRows.last().getByLabel(`Удалить ${egg.name}`).click();
  await expect(todayEggRows).toHaveCount(todayEggCount);
  await page.waitForTimeout(9_000);
  expect(remoteDeleteCalls).toBe(0);
  await expect.poll(() => remoteDeleteCalls, { timeout: 12_000 }).toBe(1);
  await page.reload(); await openApp(page); await settleUi(page);
  await page.getByRole('button', { name: 'Питание', exact: true }).click();
  await expect(todayEggRows).toHaveCount(todayEggCount);
  await picker.fill(fixtureDay);
  await expect(picker).toHaveValue(fixtureDay);
  await picker.fill(localIsoDay(-1));
  await expect(picker).toHaveValue(fixtureDay);
  await waitForHistoricalNutrition(page);

  await page.getByRole('button', { name: 'Что вы съели?' }).click();
  await page.locator('.flux-product-row').filter({ hasText: egg.name }).first().click();
  await page.getByRole('button', { name: /Добавить в / }).click();
  await expect(page.locator('.flux-drawer')).toHaveCount(0);
  const eggRows = page.locator('.flux-meal-row').filter({ hasText: egg.name });
  await expect(eggRows).toHaveCount(1);

  await page.reload(); await openApp(page); await settleUi(page);
  await page.getByRole('button', { name: 'Питание', exact: true }).click();
  await page.getByLabel('Выбрать дату питания').fill(fixtureDay);
  await waitForHistoricalNutrition(page);
  await expect(eggRows).toHaveCount(1);

  await eggRows.getByLabel(`Изменить ${egg.name}`).click();
  const editDrawer = page.getByRole('dialog');
  await editDrawer.getByLabel('Количество, г').fill('120');
  await editDrawer.getByRole('button', { name: 'Перекус', exact: true }).click();
  await editDrawer.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await expect(eggRows).toContainText('120 г');

  await page.getByLabel('Повторить предыдущий перекус').click();
  const repeatDrawer = page.getByRole('dialog');
  await repeatDrawer.locator('.flux-repeat-history-row').filter({ hasText: egg.name }).click();
  await repeatDrawer.getByRole('button', { name: 'Повторить приём пищи', exact: true }).click();
  await expect(page.locator('.flux-drawer')).toHaveCount(0);
  await expect(eggRows).toHaveCount(2);

  await page.getByLabel('Выбрать дату питания').fill(today);
  await expect(eggRows).toHaveCount(todayEggCount);
  await page.getByLabel('Выбрать дату питания').fill(fixtureDay);
  await waitForHistoricalNutrition(page);
  await expect(eggRows).toHaveCount(2);
  await eggRows.first().getByLabel(`Удалить ${egg.name}`).click();
  await expect(eggRows).toHaveCount(1);
  await eggRows.first().getByLabel(`Удалить ${egg.name}`).click();
  await expect(eggRows).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Отменить', exact: true }).first().click();
  await expect(eggRows).toHaveCount(1);
  await eggRows.first().getByLabel(`Удалить ${egg.name}`).click();
  await expect(eggRows).toHaveCount(0);
  await expect.poll(() => remoteDeleteCalls, { timeout: 12_000 }).toBe(3);

  await page.route('**/functions/v1/product-search', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { mode?: string };
    if (body.mode === 'name-search') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'found', candidates: [
        { source: 'nutriapix', name: fixture.productName('Nutriapix'), brand: 'FLUX test', slug: 'e2e-nutrition-historical' },
        { source: 'open_food_facts', name: 'E2E Open Food Facts', brand: 'OFF test', product: { id: 'open-food-facts:e2e', name: 'E2E Open Food Facts', brand: 'OFF test', amount: 100, unit: 'г', servingSizeG: 100, kcal: 120, protein: 4, fat: 3, carbs: 18, icon: 'curd' } },
        { source: 'fatsecret', name: 'E2E FatSecret', brand: 'FatSecret test', product: { id: 'fatsecret:e2e', name: 'E2E FatSecret', brand: 'FatSecret test', amount: 250, unit: 'мл', servingSizeG: 250, kcal: 95, protein: 2, fat: 1, carbs: 16, icon: 'coffee' } },
      ] }) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'found', product: { id: 'nutriapix:e2e-nutrition-historical', name: fixture.productName('Nutriapix'), brand: 'FLUX test', amount: 100, unit: 'г', servingSizeG: 100, kcal: 90, protein: 3, fat: 2, carbs: 14, icon: 'curd', source: 'nutriapix', externalFoodId: '1234567890123456789012345', externalBrandId: 'e2e-brand', externalServingId: 'e2e-serving' } }) });
  });
  await page.route('**/cgi/search.pl*', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ products: [] }) });
  });
  await page.getByRole('button', { name: 'Что вы съели?' }).click();
  await page.getByLabel('Найти продукт, бренд или штрихкод').fill('nutri');
  const offResult = page.locator('.flux-product-row').filter({ hasText: 'E2E Open Food Facts' });
  await expect(offResult).toContainText('120');
  await expect(offResult).toContainText('ккал');
  await expect(offResult).toContainText('за 100 г');
    await expect(offResult.locator('.flux-product-macro-preview')).toHaveText('Белки 4 · Жиры 3 · Углеводы 18');
  const fatSecretResult = page.locator('.flux-product-row').filter({ hasText: 'E2E FatSecret' });
  await expect(fatSecretResult).toContainText('95');
  await expect(fatSecretResult).toContainText('ккал');
  await expect(fatSecretResult).toContainText('за 250 мл');
    await expect(fatSecretResult.locator('.flux-product-macro-preview')).toHaveText('Белки 2 · Жиры 1 · Углеводы 16');
  const nutriapixResult = page.locator('.flux-product-row').filter({ hasText: fixture.productName('Nutriapix') });
  await expect(nutriapixResult).toContainText('Nutriapix');
  await expect(nutriapixResult).not.toContainText('ккал');
  await expect(nutriapixResult.locator('.flux-product-macro-preview')).toHaveCount(0);
  await nutriapixResult.click();
  const externalAddResponse = page.waitForResponse((response) => response.url().includes('/rpc/add_external_meal_item'));
  await page.getByRole('button', { name: /Добавить в / }).click();
  expect((await externalAddResponse).status()).toBe(200);
  await expect(page.locator('.flux-drawer')).toHaveCount(0);
  const externalRows = page.locator('.flux-meal-row').filter({ hasText: fixture.productName('Nutriapix') });
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
  await externalRows.getByLabel(`Удалить ${fixture.productName('Nutriapix')}`).click();
  await expect(externalRows).toHaveCount(0);
  await expect.poll(() => remoteDeleteCalls, { timeout: 12_000 }).toBe(4);

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
  } finally {
    await fixture.cleanup();
    await context?.close();
  }
});

test('targeted: Nutrition keeps stale content stable until the selected day is ready', async ({ browser }) => {
  const { context, page, userId } = await authenticatedContext(browser, 'NUTRITION_E2E_CLIENT', 320);
  const fixture = createNutritionFixtureScope(userId, 'Stale transition');
  const oatmeal = await fixture.createProduct('Овсянка', { amount: 60, kcal: 220, protein: 7.2, carbs: 36, fat: 4.2 });
  await fixture.seedEntry(oatmeal, { meal: 'breakfast', eatenAt: '2024-01-15T08:00:00+04:00', quantity: 60 });
  try {
  const errors = collectRuntime(page);
  await openApp(page); await settleUi(page);
  const picker = page.getByLabel('Выбрать дату питания');
  const dayWithEntries = historicalNutritionDay;
  const emptyDay = '2024-01-14';
  const intermediateDay = '2024-01-13';
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
  await expect(page.getByText('Дневник пока пуст', { exact: true })).toHaveCount(0);
  await expect(page.locator('.flux-meal-list > .flux-meal-group')).toHaveCount(4);

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
  } finally {
    await fixture.cleanup();
    await context.close();
  }
});

test('targeted: Nutrition date navigation fits from 320 to 430', async ({ browser }) => {
  for (const width of [320, 375, 390, 430]) {
    const { context, page, errors } = await pageFor(browser, 'NUTRITION_E2E_CLIENT', width, true);
    await page.getByRole('button', { name: 'Питание', exact: true }).click();
    await expect(page.locator('.flux-food-day-nav')).toBeVisible();
    await expect(page.getByLabel('Выбрать дату питания')).toBeVisible();
    await expect(page.getByLabel('Показать предыдущий день')).toBeVisible();
    await expect(page.getByLabel('Показать следующий день')).toBeDisabled();
    await page.getByRole('button', { name: 'Что вы съели?' }).click();
    const product = page.locator('.flux-product-row').first();
    await expect(product).toBeVisible();
    const macroPreview = product.locator('.flux-product-macro-preview');
    await expect(macroPreview).toContainText(/^Белки .+ · Жиры .+ · Углеводы .+$/);
    expect(await macroPreview.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await product.click();
    await expectNutrientValuesOnOneLine(page);
    if (width === 320 || width === 390) await stableScreenshot(page, `test-results/screenshots/targeted-nutrition-product-card-${width}.png`);
    await expectPortionValueLayout(page, 'г', '1000.5');
    await page.getByRole('button', { name: 'Назад к продуктам', exact: true }).click();
    await page.locator('.flux-product-row').filter({ hasText: 'Капучино' }).first().click();
    await expectPortionValueLayout(page, 'мл', '250.5');
    await page.getByRole('button', { name: 'Назад к продуктам', exact: true }).click();
    await page.locator('.flux-product-row').filter({ hasText: 'Яйца' }).first().click();
    await expectPortionValueLayout(page, 'шт', '3');
    await expect(page.getByRole('button', { name: /Добавить в / })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await stableScreenshot(page, `test-results/screenshots/targeted-nutrition-date-nav-${width}.png`);
    expect(errors().filter((error) => !error.includes('status of 400'))).toEqual([]);
    await context.close();
  }
});

test('targeted: Nutrition search previews only source-provided macros', async ({ browser }) => {
  const { context, page } = await signedInPage(browser, 'NUTRITION_E2E_CLIENT', 390);
  const errors = collectRuntime(page);
  await openApp(page); await settleUi(page);
  await page.route('**/functions/v1/product-search', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { mode?: string };
    if (body.mode !== 'name-search') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'not_found' }) });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'found', candidates: [
      { source: 'nutriapix', name: 'E2E Nutriapix preview', brand: 'FLUX test', slug: 'e2e-preview' },
      { source: 'open_food_facts', name: 'E2E Open Food Facts preview', brand: 'OFF test', product: { id: 'open-food-facts:preview', name: 'E2E Open Food Facts preview', brand: 'OFF test', amount: 100, unit: 'г', servingSizeG: 100, kcal: 364, protein: 12.1, fat: 6.2, carbs: 61.4, icon: 'wheat' } },
      { source: 'fatsecret', name: 'E2E FatSecret preview', brand: 'FatSecret test', product: { id: 'fatsecret:preview', name: 'E2E FatSecret preview', brand: 'FatSecret test', amount: 250, unit: 'мл', servingSizeG: 250, kcal: 95, protein: 2, fat: 1, carbs: 16, icon: 'coffee' } },
    ] }) });
  });
  await page.route('**/cgi/search.pl*', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ products: [] }) });
  });

  await page.getByRole('button', { name: 'Питание', exact: true }).click();
  await page.getByRole('button', { name: 'Что вы съели?' }).click();
  await page.getByLabel('Найти продукт, бренд или штрихкод').fill('E2E macro preview');

  const off = page.locator('.flux-product-row').filter({ hasText: 'E2E Open Food Facts preview' });
  await expect(off).toContainText('364');
  await expect(off).toContainText('ккал');
  await expect(off).toContainText('за 100 г');
  await expect(off.locator('.flux-product-macro-preview')).toHaveText('Белки 12,1 · Жиры 6,2 · Углеводы 61,4');
  const fatSecret = page.locator('.flux-product-row').filter({ hasText: 'E2E FatSecret preview' });
  await expect(fatSecret.locator('.flux-product-macro-preview')).toHaveText('Белки 2 · Жиры 1 · Углеводы 16');
  const nutriapix = page.locator('.flux-product-row').filter({ hasText: 'E2E Nutriapix preview' });
  await expect(nutriapix.locator('.flux-product-macro-preview')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  expect(errors().filter((error) => !error.includes('status of 400'))).toEqual([]);
  await context.close();
});
