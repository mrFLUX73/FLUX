import { expect, test } from '@playwright/test';
import { openApp, statePath } from './helpers';

const baseUrl = process.env.FLUX_E2E_BASE_URL ?? 'http://127.0.0.1:4179';

test('diagnostic: Test Trainer clients screen has no hidden dimming layer', async ({ browser }) => {
  const context = await browser.newContext({ storageState: statePath('TRAINER'), viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(baseUrl);
  await openApp(page);
  await page.getByRole('button', { name: 'Клиенты', exact: true }).click();
  await expect(page.getByText('Илья Северин', { exact: true })).toBeVisible();
  await expect(page.locator('[role="dialog"], [aria-modal="true"]')).toHaveCount(0);
  await page.waitForTimeout(1_000);

  const diagnostics = await page.evaluate(() => {
    const viewportArea = window.innerWidth * window.innerHeight;
    const describe = (element: Element, pseudo?: '::before' | '::after') => {
      const style = getComputedStyle(element, pseudo);
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        id: (element as HTMLElement).id || null,
        className: (element as HTMLElement).className || null,
        pseudo: pseudo ?? null,
        area: Math.round(rect.width * rect.height),
        position: style.position,
        zIndex: style.zIndex,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        background: style.backgroundColor,
        filter: style.filter,
        backdropFilter: style.backdropFilter,
      };
    };
    const overlays = [...document.querySelectorAll('*')].flatMap((element) => {
      const rows = [describe(element), describe(element, '::before'), describe(element, '::after')];
      return rows.filter((row) => {
        const coversMostViewport = row.area > viewportArea * 0.55;
        const layerLike = row.position === 'fixed' || row.position === 'absolute';
        const visuallyActive = row.opacity !== '0' && row.display !== 'none' && row.visibility !== 'hidden';
        return coversMostViewport && layerLike && visuallyActive;
      });
    });
    const mutedAncestors = [...document.querySelectorAll('main, #root, [role="main"], [aria-label="Приложение FLUX"]')]
      .map((element) => describe(element))
      .filter((row) => row.opacity !== '1' || row.filter !== 'none' || row.backdropFilter !== 'none');
    return { overlays, mutedAncestors, dialogs: document.querySelectorAll('[role="dialog"], [aria-modal="true"]').length };
  });
  console.log(`FLUX_VISUAL_DIAGNOSTIC ${JSON.stringify(diagnostics)}`);
  await page.screenshot({ path: 'test-results/screenshots/test-trainer-clients-stable.png', fullPage: true, animations: 'disabled' });
  await context.close();
});
