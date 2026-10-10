import { expect, test } from '@playwright/test';
import { authenticatedContext, collectRuntime, createWorkoutFixtureScope, expectNoHorizontalOverflow, openApp, settleUi, storedSessionRpc } from './helpers';

async function openWorkout(browser: import('@playwright/test').Browser, width = 390) {
  const { context, page, userId } = await authenticatedContext(browser, 'WORKOUT_E2E_CLIENT', width);
  const errors = collectRuntime(page);
  await openApp(page);
  await expect(page.getByLabel('Открыть мой профиль')).toBeVisible({ timeout: 15_000 });
  return { context, page, userId, errors };
}

async function prepareEngineFixture(page: import('@playwright/test').Page, userId: string, label: string) {
  const fixture = createWorkoutFixtureScope(page, userId, label);
  await fixture.assertNoActiveWorkout();
  const reps = await fixture.createExercise('Приседания', 'reps');
  const duration = await fixture.createExercise('Отжимания', 'duration');
  const plan = await fixture.savePlan([
    { exerciseId: reps.id, targetSets: 2, targetRepsMin: 12, targetDurationSeconds: null, targetDistanceM: null, targetWeightKg: null, restSeconds: 30 },
    { exerciseId: duration.id, targetSets: 3, targetRepsMin: null, targetDurationSeconds: 20, targetDistanceM: null, targetWeightKg: null, restSeconds: 10 },
  ]) as { id: string };
  return { fixture, planId: plan.id, repsName: reps.name, durationName: duration.name };
}

async function openFixturePlan(page: import('@playwright/test').Page, planName: string) {
  await page.getByRole('button', { name: 'Тренировки', exact: true }).click();
  await settleUi(page);
  await page.locator('.flux-workout-list-button').filter({ hasText: planName }).click();
  await settleUi(page);
  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Активная тренировка' })).toBeVisible();
}

test('Workout Engine: Test Client starts a server session and persists an in-progress set', async ({ browser }) => {
  const { context, page, userId, errors } = await openWorkout(browser);
  const { fixture, repsName } = await prepareEngineFixture(page, userId, 'Engine persistence');
  try {
    await openFixturePlan(page, fixture.planName);
    const active = await storedSessionRpc(page, 'get_my_active_workout_session', {});
    expect(active.status).toBe(200); fixture.registerSession(active.data as { id: string; title?: string; plan_id?: string | null });
    await expect(page.getByLabel('История тренировок')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole('heading', { name: repsName, exact: true })).toBeVisible();
    await page.getByLabel('Повторы').fill('14');
    await page.getByLabel('Вес, кг').fill('32.5');
    await page.getByRole('button', { name: 'Начать подход', exact: true }).click();
    await expect(page.getByText('Подход выполняется', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Тяжело', exact: true }).click();
    await page.getByRole('button', { name: 'Завершить подход', exact: true }).click();
    await expect(page.getByText('Можно выдохнуть', { exact: true })).toBeVisible();
    await page.getByLabel('Вернуться к тренировкам').click();
    await page.reload(); await settleUi(page);
    await page.getByRole('button', { name: 'Тренировки', exact: true }).click(); await settleUi(page);
    await expect(page.getByText('Незавершённая тренировка', { exact: false })).toBeVisible();
    expect(errors()).toEqual([]);
  } finally {
    await fixture.cleanup();
    await context.close();
  }
});

test('Workout Engine: Test Client reaches duration, pauses and resumes an active session', async ({ browser }) => {
  test.setTimeout(60_000);
  const { context, page, userId, errors } = await openWorkout(browser);
  const { fixture, durationName } = await prepareEngineFixture(page, userId, 'Engine duration');
  try {
    await openFixturePlan(page, fixture.planName);
    const active = await storedSessionRpc(page, 'get_my_active_workout_session', {});
    expect(active.status).toBe(200); fixture.registerSession(active.data as { id: string; title?: string; plan_id?: string | null });
    for (let index = 0; index < 2; index += 1) {
      await page.getByLabel('Повторы').fill('13');
      await page.getByRole('button', { name: 'Начать подход', exact: true }).click();
      await page.getByRole('button', { name: 'Завершить подход', exact: true }).click();
      await expect(page.getByText('Можно выдохнуть', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Пропустить отдых', exact: true }).click();
      if (index === 0) await expect(page.getByRole('button', { name: 'Начать подход', exact: true })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Перейти к упражнению', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Перейти к упражнению', exact: true }).click();
    await expect(page.getByRole('heading', { name: durationName, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Начать отсчёт', exact: true }).click();
    await expect(page.getByText('Выполнение', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Пауза', exact: true }).click();
    await expect(page.getByText('Таймер на паузе', { exact: true })).toBeVisible();
    await page.getByLabel('Вернуться к тренировкам').click();
    await page.reload(); await settleUi(page); await page.getByRole('button', { name: 'Тренировки', exact: true }).click(); await settleUi(page);
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Начать отсчёт', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Начать отсчёт', exact: true }).click();
    await expect(page.getByText('Выполнение', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(errors()).toEqual([]);
  } finally {
    await fixture.cleanup();
    await context.close();
  }
});

async function verifyWorkoutResponsive(browser: import('@playwright/test').Browser, widths: number[]) {
  const owner = await openWorkout(browser);
  const { fixture } = await prepareEngineFixture(owner.page, owner.userId, 'Engine responsive');
  let ownerClosed = false;
  try {
    await owner.context.close(); ownerClosed = true;
    for (const width of widths) {
      const { context, page, errors } = await openWorkout(browser, width);
      await page.getByRole('button', { name: 'Тренировки', exact: true }).click();
      await settleUi(page);
      await expect(page.getByText('Мои планы', { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.locator('.flux-workout-list-button').filter({ hasText: fixture.planName }).click();
      await settleUi(page);
      await expect(page.getByText('Упражнения', { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(errors()).toEqual([]);
      await context.close();
    }
  } finally {
    await fixture.cleanup();
    if (!ownerClosed) await owner.context.close();
  }
}

test('Workout Engine: 320–375 px has no overflow', async ({ browser }) => {
  await verifyWorkoutResponsive(browser, [320, 375]);
});

test('Workout Engine: 390–430 px has no overflow', async ({ browser }) => {
  await verifyWorkoutResponsive(browser, [390, 430]);
});

test('Workout Engine: saves are idempotent and another user cannot read the session', async ({ browser }) => {
  const client = await openWorkout(browser);
  const { fixture, planId } = await prepareEngineFixture(client.page, client.userId, 'Engine idempotency');
  try {
    const session = await fixture.startPlan(planId) as { id: string; plan_snapshot: Array<{ step_id: string }> };
    const stepId = session.plan_snapshot[0]?.step_id;
    expect(stepId).toBeTruthy();
    const clientSetKey = '10000000-0000-4000-8000-000000000029';
    const first = await storedSessionRpc(client.page, 'save_my_performed_set', { p_session_id: session.id, p_client_set_key: clientSetKey, p_session_step_id: stepId, p_set_number: 1, p_reps: 12, p_weight_kg: 20, p_duration_seconds: null, p_distance_m: null, p_rpe: 7, p_notes: null });
    const retry = await storedSessionRpc(client.page, 'save_my_performed_set', { p_session_id: session.id, p_client_set_key: clientSetKey, p_session_step_id: stepId, p_set_number: 1, p_reps: 13, p_weight_kg: 22, p_duration_seconds: null, p_distance_m: null, p_rpe: 8, p_notes: null });
    expect(first.status).toBe(200); expect(retry.status).toBe(200);
    expect((first.data as { id: string }).id).toBe((retry.data as { id: string }).id);
    const reloaded = await storedSessionRpc(client.page, 'get_my_workout_session', { p_session_id: session.id });
    const saved = (reloaded.data as { sets: Array<{ client_set_key: string; reps: number; weight_kg: number; rpe: number }> }).sets.filter((item) => item.client_set_key === clientSetKey);
    expect(saved).toEqual([expect.objectContaining({ reps: 13, weight_kg: 22, rpe: 8 })]);
    const other = await authenticatedContext(browser, 'OTHER_TRAINER');
    const denied = await storedSessionRpc(other.page, 'get_my_workout_session', { p_session_id: session.id });
    expect(denied.authenticated).toBe(true); expect(denied.status).not.toBe(200);
    await other.context.close();
  } finally {
    await fixture.cleanup();
    await client.context.close();
  }
});
