import { expect, test } from '@playwright/test';
import { authenticatedContext, collectRuntime, createWorkoutFixtureScope, expectNoHorizontalOverflow, openApp, settleUi, storedSessionRpc } from './helpers';

async function openWorkouts(browser: import('@playwright/test').Browser, persona: 'WORKOUT_E2E_CLIENT' | 'OTHER_TRAINER' = 'WORKOUT_E2E_CLIENT', width = 390) {
  const { context, page, userId } = await authenticatedContext(browser, persona, width);
  const errors = collectRuntime(page);
  const httpErrors: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
  });
  await openApp(page); await expect(page.getByLabel('Открыть мой профиль')).toBeVisible({ timeout: 15_000 }); await page.getByRole('button', { name: 'Тренировки', exact: true }).click(); await settleUi(page);
  return { context, page, userId, errors, httpErrors };
}

test('Personal Plan Editor: Empty Client creates, reloads and starts a personal plan', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page, userId, errors, httpErrors } = await openWorkouts(browser);
  const fixture = createWorkoutFixtureScope(page, userId, 'Personal editor');
  try {
    await fixture.assertNoActiveWorkout();
    await expect(page.getByText(fixture.planName, { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Создать план', exact: true }).click();
    await page.getByLabel('Название плана').fill(fixture.planName);
    await page.getByLabel('Описание').fill(fixture.description);
    await page.getByRole('button', { name: 'К упражнениям', exact: true }).click();
    const exercises = [[fixture.exerciseName('Присед'), 'Повторения'], [fixture.exerciseName('Планка'), 'Время'], [fixture.exerciseName('Бег'), 'Дистанция']] as const;
    for (const [index, [name, type]] of exercises.entries()) {
      await page.getByRole('button', { name: 'Добавить упражнение', exact: true }).click();
      await page.getByLabel('Название нового упражнения').fill(name);
      await page.getByRole('button', { name: type, exact: true }).click();
      await page.getByRole('button', { name: 'Создать упражнение', exact: true }).click();
      await expect(page.locator('.flux-editor-step-list article')).toHaveCount(index + 1);
    }
    await page.getByLabel('Выше').last().click();
    await page.getByLabel(`Настроить ${fixture.exerciseName('Бег')}`).click();
    await page.getByLabel('Дистанция, м').fill('1500');
    await page.getByLabel('Отдых, сек').fill('45');
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await page.getByRole('button', { name: 'К проверке', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить план', exact: true }).click();
    await expect(page.getByText(fixture.planName, { exact: true }).first()).toBeVisible();
    await expect.poll(async () => {
      const result = await storedSessionRpc(page, 'get_my_workout_plans', {});
      if (result.status !== 200 || !Array.isArray(result.data)) return false;
      const plan = result.data.find((item) => (item as { name?: string }).name === fixture.planName) as { id?: string; name?: string } | undefined;
      if (!plan?.id) return false;
      fixture.registerPlan({ id: plan.id, name: plan.name });
      const detail = await storedSessionRpc(page, 'get_my_workout_plan', { p_plan_id: plan.id });
      if (detail.status !== 200 || !detail.data || typeof detail.data !== 'object') return false;
      const exercises = (detail.data as { exercises?: Array<{ exercise_id?: string; name?: string }> }).exercises ?? [];
      if (exercises.length !== 3 || exercises.some((exercise) => !exercise.exercise_id || !exercise.name)) return false;
      exercises.forEach((exercise) => fixture.registerExercise({ id: exercise.exercise_id!, name: exercise.name! }));
      return true;
    }).toBe(true);
    await page.reload(); await settleUi(page); await page.getByRole('button', { name: 'Тренировки', exact: true }).click(); await settleUi(page);
    await expect(page.getByText(fixture.planName, { exact: true }).first()).toBeVisible();
    await page.locator('.flux-workout-list-button').filter({ hasText: fixture.planName }).first().click(); await settleUi(page);
    await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Активная тренировка' })).toBeVisible();
    const active = await storedSessionRpc(page, 'get_my_active_workout_session', {});
    expect(active.status).toBe(200); fixture.registerSession(active.data as { id: string; title?: string; plan_id?: string | null });
    await expectNoHorizontalOverflow(page); expect(errors()).toEqual([]); expect(httpErrors).toEqual([]);
  } finally {
    await fixture.cleanup();
    await context.close();
  }
});

test('Personal Plan Editor: RPC saves atomically, snapshots and protects used exercises', async ({ browser }) => {
  test.setTimeout(60_000);
  const { context: client, page: clientPage, userId } = await authenticatedContext(browser, 'WORKOUT_E2E_CLIENT');
  const fixture = createWorkoutFixtureScope(clientPage, userId, 'RPC editor');
  try {
  await fixture.assertNoActiveWorkout();
  const [reps, duration] = await Promise.all([fixture.createExercise('Тяга', 'reps'), fixture.createExercise('Вис', 'duration')]);
  const value = await fixture.savePlan([{ exerciseId: reps.id, targetSets: 2, targetRepsMin: 8, targetDurationSeconds: null, targetDistanceM: null, targetWeightKg: 20, restSeconds: 45 }, { exerciseId: duration.id, targetSets: 2, targetRepsMin: null, targetDurationSeconds: 20, targetDistanceM: null, targetWeightKg: null, restSeconds: 30 }]) as { id: string; exercises: Array<{ step_id: string }> };
  const snapshot = await fixture.startPlan(value.id) as { id: string; plan_snapshot: Array<{ target_reps_min: number }> };
  const edited = await storedSessionRpc(clientPage, 'save_my_workout_plan', { p_plan_id: value.id, p_name: fixture.planName, p_description: fixture.description, p_level: 'beginner', p_estimated_duration_minutes: 20, p_steps: [{ exercise_id: reps.id, target_sets: 2, target_reps_min: 12, target_reps_max: null, target_duration_seconds: null, target_distance_m: null, target_weight_kg: 20, rest_seconds: 45, notes: null }, { exercise_id: duration.id, target_sets: 2, target_reps_min: null, target_reps_max: null, target_duration_seconds: 20, target_distance_m: null, target_weight_kg: null, rest_seconds: 30, notes: null }] });
  expect(edited.status).toBe(200);
  const active = await storedSessionRpc(clientPage, 'get_my_workout_session', { p_session_id: snapshot.id });
  expect((active.data as { plan_snapshot: Array<{ target_reps_min: number }> }).plan_snapshot[0].target_reps_min).toBe(8);
  const protectedDelete = await storedSessionRpc(clientPage, 'delete_my_exercise', { p_exercise_id: reps.id });
  expect(protectedDelete.status).not.toBe(200);
  const duplicate = await storedSessionRpc(clientPage, 'duplicate_my_workout_plan', { p_plan_id: value.id });
  expect(duplicate.status).toBe(200);
  const copyId = (duplicate.data as { id: string }).id;
  fixture.registerPlan({ id: copyId });
  expect(copyId).not.toBe(value.id);
  const completed = await storedSessionRpc(clientPage, 'complete_my_workout_session', { p_session_id: snapshot.id, p_overall_rpe: null, p_notes: null });
  expect(completed.status).toBe(200);
  const archived = await storedSessionRpc(clientPage, 'archive_my_workout_plan', { p_plan_id: copyId });
  expect(archived.status).toBe(204);
  const archivedStart = await storedSessionRpc(clientPage, 'start_personal_workout', { p_plan_id: copyId });
  expect(archivedStart.status).not.toBe(200);
  const deleted = await storedSessionRpc(clientPage, 'delete_my_workout_plan', { p_plan_id: copyId });
  expect(deleted.status).toBe(204);
  fixture.forgetPlan(copyId);
  const { context: other, page: otherPage } = await authenticatedContext(browser, 'OTHER_TRAINER');
  const denied = await storedSessionRpc(otherPage, 'get_my_workout_plan', { p_plan_id: value.id });
  expect(denied.status).not.toBe(200);
  await other.close();
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});

test('Personal Plan Editor: editor fits 320–430 px', async ({ browser }) => {
  for (const width of [320, 375, 390, 430]) {
    const { context, page, errors, httpErrors } = await openWorkouts(browser, 'WORKOUT_E2E_CLIENT', width);
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
