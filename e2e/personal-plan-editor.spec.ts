import { expect, test } from '@playwright/test';
import { authenticatedContext, collectRuntime, expectNoHorizontalOverflow, openApp, settleUi, storedSessionRpc } from './helpers';

async function openWorkouts(browser: import('@playwright/test').Browser, persona: 'EMPTY_CLIENT' | 'OTHER_TRAINER' = 'EMPTY_CLIENT', width = 390) {
  const { context, page } = await authenticatedContext(browser, persona, width);
  const errors = collectRuntime(page);
  const httpErrors: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
  });
  await openApp(page); await expect(page.getByLabel('Открыть мой профиль')).toBeVisible(); await page.getByRole('button', { name: 'Тренировки', exact: true }).click(); await settleUi(page);
  return { context, page, errors, httpErrors };
}

test('Personal Plan Editor: Empty Client creates, reloads and starts a personal plan', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page, errors, httpErrors } = await openWorkouts(browser);
  await expect(page.getByText('Планов пока нет', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Создать план', exact: true }).click();
  await page.getByLabel('Название плана').fill('План E2E');
  await page.getByRole('button', { name: 'К упражнениям', exact: true }).click();
  const exercises = [['Присед E2E', 'Повторы'], ['Планка E2E', 'Длительность'], ['Бег E2E', 'Дистанция']] as const;
  for (const [index, [name, type]] of exercises.entries()) {
    await page.getByRole('button', { name: 'Добавить упражнение', exact: true }).click();
    await page.getByPlaceholder('Название').fill(name);
    await page.locator('.flux-create-exercise select').selectOption({ label: type });
    await page.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(page.locator('.flux-editor-step-list article')).toHaveCount(index + 1);
  }
  await page.getByLabel('Выше').last().click();
  await page.getByLabel('Настроить Бег E2E').click();
  await page.getByLabel('Дистанция, м').fill('1500');
  await page.getByLabel('Отдых, сек').fill('45');
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await page.getByRole('button', { name: 'К проверке', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить план', exact: true }).click();
  await expect(page.getByText('План E2E', { exact: true }).first()).toBeVisible();
  await expect.poll(async () => {
    const result = await storedSessionRpc(page, 'get_my_workout_plans', {});
    return result.status === 200 && Array.isArray(result.data) && result.data.some((item) => (item as { name?: string }).name === 'План E2E');
  }).toBe(true);
  await page.reload(); await settleUi(page); await page.getByRole('button', { name: 'Тренировки', exact: true }).click(); await settleUi(page);
  await expect(page.getByText('План E2E', { exact: true }).first()).toBeVisible();
  await page.locator('.flux-workout-list-button').filter({ hasText: 'План E2E' }).first().click(); await settleUi(page);
  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Активная тренировка' })).toBeVisible();
  await expectNoHorizontalOverflow(page); expect(errors()).toEqual([]); expect(httpErrors).toEqual([]);
  await context.close();
});

test('Personal Plan Editor: RPC saves atomically, snapshots and protects used exercises', async ({ browser }) => {
  test.setTimeout(60_000);
  const { context: client, page: clientPage } = await authenticatedContext(browser, 'CLIENT');
  const create = async (name: string, type: string) => storedSessionRpc(clientPage, 'create_my_exercise', { p_name: name, p_measurement_type: type, p_instructions: null, p_category: null });
  const [reps, duration] = await Promise.all([create('Тяга RPC E2E', 'reps'), create('Вис RPC E2E', 'duration')]);
  expect(reps.status).toBe(200); expect(duration.status).toBe(200);
  const plan = await storedSessionRpc(clientPage, 'save_my_workout_plan', { p_plan_id: null, p_name: 'RPC план E2E', p_description: null, p_level: 'beginner', p_estimated_duration_minutes: 20, p_steps: [{ exercise_id: (reps.data as { id: string }).id, target_sets: 2, target_reps_min: 8, target_reps_max: null, target_duration_seconds: null, target_distance_m: null, target_weight_kg: 20, rest_seconds: 45, notes: null }, { exercise_id: (duration.data as { id: string }).id, target_sets: 2, target_reps_min: null, target_reps_max: null, target_duration_seconds: 20, target_distance_m: null, target_weight_kg: null, rest_seconds: 30, notes: null }] });
  expect(plan.status).toBe(200);
  const value = plan.data as { id: string; exercises: Array<{ step_id: string }> };
  const started = await storedSessionRpc(clientPage, 'start_personal_workout', { p_plan_id: value.id });
  expect(started.status).toBe(200); const snapshot = started.data as { id: string; plan_snapshot: Array<{ target_reps_min: number }> };
  const edited = await storedSessionRpc(clientPage, 'save_my_workout_plan', { p_plan_id: value.id, p_name: 'RPC план E2E', p_description: null, p_level: 'beginner', p_estimated_duration_minutes: 20, p_steps: [{ exercise_id: (reps.data as { id: string }).id, target_sets: 2, target_reps_min: 12, target_reps_max: null, target_duration_seconds: null, target_distance_m: null, target_weight_kg: 20, rest_seconds: 45, notes: null }, { exercise_id: (duration.data as { id: string }).id, target_sets: 2, target_reps_min: null, target_reps_max: null, target_duration_seconds: 20, target_distance_m: null, target_weight_kg: null, rest_seconds: 30, notes: null }] });
  expect(edited.status).toBe(200);
  const active = await storedSessionRpc(clientPage, 'get_my_workout_session', { p_session_id: snapshot.id });
  expect((active.data as { plan_snapshot: Array<{ target_reps_min: number }> }).plan_snapshot[0].target_reps_min).toBe(8);
  const protectedDelete = await storedSessionRpc(clientPage, 'delete_my_exercise', { p_exercise_id: (reps.data as { id: string }).id });
  expect(protectedDelete.status).not.toBe(200);
  const duplicate = await storedSessionRpc(clientPage, 'duplicate_my_workout_plan', { p_plan_id: value.id });
  expect(duplicate.status).toBe(200);
  const copyId = (duplicate.data as { id: string }).id;
  expect(copyId).not.toBe(value.id);
  const completed = await storedSessionRpc(clientPage, 'complete_my_workout_session', { p_session_id: snapshot.id, p_overall_rpe: null, p_notes: null });
  expect(completed.status).toBe(200);
  const archived = await storedSessionRpc(clientPage, 'archive_my_workout_plan', { p_plan_id: copyId });
  expect(archived.status).toBe(204);
  const archivedStart = await storedSessionRpc(clientPage, 'start_personal_workout', { p_plan_id: copyId });
  expect(archivedStart.status).not.toBe(200);
  const deleted = await storedSessionRpc(clientPage, 'delete_my_workout_plan', { p_plan_id: copyId });
  expect(deleted.status).toBe(204);
  const { context: other, page: otherPage } = await authenticatedContext(browser, 'OTHER_TRAINER');
  const denied = await storedSessionRpc(otherPage, 'get_my_workout_plan', { p_plan_id: value.id });
  expect(denied.status).not.toBe(200);
  await other.close(); await client.close();
});

test('Personal Plan Editor: editor fits 320–430 px', async ({ browser }) => {
  for (const width of [320, 375, 390, 430]) {
    const { context, page, errors, httpErrors } = await openWorkouts(browser, 'EMPTY_CLIENT', width);
    await page.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Создать план' })).toBeVisible();
    await expect(page.getByLabel('Название плана')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole('button', { name: 'К упражнениям', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Добавить упражнение', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(errors()).toEqual([]); expect(httpErrors).toEqual([]);
    await context.close();
  }
});
