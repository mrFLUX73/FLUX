import { expect, test } from '@playwright/test';
import { authenticatedContext, openApp, statePath } from './helpers';

const personas = [
  ['CLIENT', 'Сегодня достаточно просто продолжить.'],
  ['TRAINER', 'Клиенты'],
  ['EMPTY_CLIENT', 'Сегодня достаточно просто продолжить.'],
  ['OTHER_TRAINER', 'Клиенты'],
] as const;

test.describe.serial('authenticated synthetic browser states', () => {
  for (const [persona, expected] of personas) {
    test(`${persona} receives a real persisted Supabase session`, async ({ browser }) => {
      const { context, page, userId } = await authenticatedContext(browser, persona);
      await openApp(page);
      if (persona === 'TRAINER' || persona === 'OTHER_TRAINER') {
        await page.getByRole('button', { name: 'Клиенты', exact: true }).click();
      }
      await expect(page.getByRole('heading', { name: expected, exact: true })).toBeVisible();
      await page.reload();
      await openApp(page);
      await context.storageState({ path: statePath(persona) });
      expect(userId).toMatch(/^[0-9a-f-]{36}$/i);
      await context.close();
    });
  }
});
