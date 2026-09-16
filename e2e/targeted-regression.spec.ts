import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { collectRuntime, expectNoHorizontalOverflow, openApp, settleUi, stableScreenshot, statePath } from './helpers';

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
