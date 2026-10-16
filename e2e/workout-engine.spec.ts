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
  const duration = await fixture.createExercise('Отжимания', 'duration', 'Примите устойчивый упор. Выполняйте движение плавно, сохраняя ровный темп.');
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

test('Workout Engine V3: executes immutable per-set targets and keeps actual values separate', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page, userId, errors } = await openWorkout(browser);
  const fixture = createWorkoutFixtureScope(page, userId, 'Engine V3 individual targets');
  try {
    await fixture.assertNoActiveWorkout();
    const exercise = await fixture.createExercise('V3 приседания', 'reps');
    const plan = await fixture.savePlanV3([{ exerciseId: exercise.id, plannedSets: [
      { targetRepsMin: 8, targetWeightKg: 40, restSeconds: 25 },
      { targetRepsMin: 12, targetWeightKg: 50, restSeconds: 0 },
    ] }]);
    await openFixturePlan(page, fixture.planName);

    const active = await storedSessionRpc(page, 'get_my_active_workout_session_v3', {});
    expect(active.status).toBe(200);
    fixture.registerSession(active.data as { id: string; title?: string; plan_id?: string | null });
    const snapshot = active.data as { plan_snapshot: Array<{ planned_sets: Array<{ set_id: string | null; set_number: number; target_reps_min: number; target_weight_kg: number; rest_seconds: number }> }> };
    expect(snapshot.plan_snapshot[0]?.planned_sets).toEqual([
      expect.objectContaining({ set_number: 1, target_reps_min: 8, target_weight_kg: 40, rest_seconds: 25 }),
      expect.objectContaining({ set_number: 2, target_reps_min: 12, target_weight_kg: 50, rest_seconds: 0 }),
    ]);
    expect(snapshot.plan_snapshot[0]?.planned_sets.every((set) => Boolean(set.set_id))).toBe(true);

    await expect(page.locator('.flux-planned-target')).toContainText('8 повторений · 40 кг');
    await expect(page.getByLabel('Повторы')).toHaveValue('8');
    await expect(page.getByLabel('Вес, кг')).toHaveValue('40');
    await page.getByLabel('Повторы').fill('7');
    await page.getByLabel('Вес, кг').fill('37.5');
    await page.getByRole('button', { name: 'Начать подход', exact: true }).click();
    await page.getByRole('button', { name: 'Завершить подход', exact: true }).click();
    await expect(page.getByText('Можно выдохнуть', { exact: true })).toBeVisible();

    await page.getByLabel('Вернуться к тренировкам').click();
    await page.reload(); await settleUi(page);
    await page.getByRole('button', { name: 'Тренировки', exact: true }).click(); await settleUi(page);
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await expect(page.locator('.flux-planned-target')).toContainText('12 повторений · 50 кг');
    await expect(page.getByLabel('Повторы')).toHaveValue('12');
    await expect(page.getByLabel('Вес, кг')).toHaveValue('50');
    await page.getByRole('button', { name: 'Начать подход', exact: true }).click();
    await page.getByRole('button', { name: 'Завершить подход', exact: true }).click();
    await expect(page.getByText('Тренировка завершена', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Сохранить тренировку', exact: true }).click();

    let completed: Awaited<ReturnType<typeof storedSessionRpc>> | null = null;
    await expect.poll(async () => {
      const result = await storedSessionRpc(page, 'get_my_workout_session_v3', { p_session_id: (active.data as { id: string }).id });
      completed = result;
      return (result.data as { status?: string } | null)?.status ?? null;
    }).toBe('completed');
    expect(completed?.status).toBe(200);
    const savedSets = (completed?.data as { sets: Array<{ set_number: number; reps: number; weight_kg: number }> }).sets;
    expect(savedSets).toEqual(expect.arrayContaining([
      expect.objectContaining({ set_number: 1, reps: 7, weight_kg: 37.5 }),
      expect.objectContaining({ set_number: 2, reps: 12, weight_kg: 50 }),
    ]));
    await expectNoHorizontalOverflow(page);
    expect(errors()).toEqual([]);
  } finally {
    await fixture.cleanup();
    await context.close();
  }
});

test('Workout Engine completion protects an unsaved draft and can finish without it', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page, userId, errors } = await openWorkout(browser);
  const fixture = createWorkoutFixtureScope(page, userId, 'Completion unsaved draft');
  try {
    await fixture.assertNoActiveWorkout();
    const exercise = await fixture.createExercise('Защита завершения', 'reps');
    await fixture.savePlanV3([{ exerciseId: exercise.id, plannedSets: [
      { targetRepsMin: 8, restSeconds: 0 },
      { targetRepsMin: 10, restSeconds: 0 },
    ] }]);
    await openFixturePlan(page, fixture.planName);
    const active = await storedSessionRpc(page, 'get_my_active_workout_session_v3', {});
    expect(active.status).toBe(200);
    const sessionId = (active.data as { id: string }).id;
    fixture.registerSession(active.data as { id: string; title?: string; plan_id?: string | null });

    await page.getByRole('button', { name: 'Начать подход', exact: true }).click();
    await page.getByRole('button', { name: 'Завершить подход', exact: true }).click();
    await expect(page.getByLabel('Повторы')).toHaveValue('10');
    await page.getByLabel('Повторы').fill('13');
    await page.getByLabel('Закрыть').click();
    await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click();

    const confirmation = page.getByRole('dialog', { name: 'Сохранить результат подхода?' });
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText(/Защита завершения.*подход 2/);
    await expect(confirmation).toContainText('13 повторений');
    const choice = confirmation.getByRole('checkbox', { name: 'Сохранить этот подход перед завершением' });
    await expect(choice).toBeChecked();
    await choice.uncheck();
    await expect(confirmation.getByRole('button', { name: 'Сохранить выбранные и завершить', exact: true })).toBeDisabled();
    await confirmation.getByRole('button', { name: 'Завершить без сохранения', exact: true }).click();

    await expect.poll(async () => {
      const result = await storedSessionRpc(page, 'get_my_workout_session_v3', { p_session_id: sessionId });
      return (result.data as { status?: string } | null)?.status ?? null;
    }).toBe('completed');
    const completed = await storedSessionRpc(page, 'get_my_workout_session_v3', { p_session_id: sessionId });
    expect((completed.data as { sets: Array<{ set_number: number; reps: number }> }).sets).toEqual([
      expect.objectContaining({ set_number: 1, reps: 8 }),
    ]);
    const checkpoint = await storedSessionRpc(page, 'get_my_workout_execution_checkpoint', { p_session_id: sessionId });
    expect(checkpoint.status).toBe(200);
    expect(checkpoint.data).toBeNull();
    expect(errors()).toEqual([]);
  } finally {
    await fixture.cleanup();
    await context.close();
  }
});

test('Workout Engine confirms an empty workout before completion', async ({ browser }) => {
  const { context, page, userId, errors } = await openWorkout(browser);
  const fixture = createWorkoutFixtureScope(page, userId, 'Completion empty workout');
  try {
    await fixture.assertNoActiveWorkout();
    const exercise = await fixture.createExercise('Пустое завершение', 'reps');
    await fixture.savePlanV3([{ exerciseId: exercise.id, plannedSets: [{ targetRepsMin: 8, restSeconds: 0 }] }]);
    await openFixturePlan(page, fixture.planName);
    const active = await storedSessionRpc(page, 'get_my_active_workout_session_v3', {});
    expect(active.status).toBe(200);
    const sessionId = (active.data as { id: string }).id;
    fixture.registerSession(active.data as { id: string; title?: string; plan_id?: string | null });

    await page.getByLabel('Закрыть').click();
    await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'В тренировке нет сохранённых подходов. Завершить её без результатов?' });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Вернуться к тренировке', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Активная тренировка' })).toBeVisible();
    await page.getByLabel('Закрыть').click();
    await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click();
    await page.getByRole('button', { name: 'Завершить без результатов', exact: true }).click();
    await expect.poll(async () => {
      const result = await storedSessionRpc(page, 'get_my_workout_session_v3', { p_session_id: sessionId });
      return (result.data as { status?: string } | null)?.status ?? null;
    }).toBe('completed');
    expect(errors()).toEqual([]);
  } finally {
    await fixture.cleanup();
    await context.close();
  }
});

test('Workout Engine completion confirmation fits 320–430px without overflow', async ({ browser }) => {
  const { context, page, userId } = await openWorkout(browser, 320);
  const fixture = createWorkoutFixtureScope(page, userId, 'Completion mobile');
  try {
    await fixture.assertNoActiveWorkout();
    const exercise = await fixture.createExercise('Мобильное завершение', 'reps');
    await fixture.savePlanV3([{ exerciseId: exercise.id, plannedSets: [{ targetRepsMin: 8, restSeconds: 0 }] }]);
    await openFixturePlan(page, fixture.planName);
    const active = await storedSessionRpc(page, 'get_my_active_workout_session_v3', {});
    expect(active.status).toBe(200);
    fixture.registerSession(active.data as { id: string; title?: string; plan_id?: string | null });
    await page.getByLabel('Закрыть').click();
    await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'В тренировке нет сохранённых подходов. Завершить её без результатов?' });
    await expect(confirmation).toBeVisible();
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await expectNoHorizontalOverflow(page);
      const box = await confirmation.boundingBox();
      expect(box).not.toBeNull();
      expect((box?.x ?? -1) >= 0).toBe(true);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 0.5);
    }
    await confirmation.getByRole('button', { name: 'Завершить без результатов', exact: true }).click();
    await expect.poll(async () => {
      const result = await storedSessionRpc(page, 'get_my_active_workout_session_v3', {});
      return result.data ?? null;
    }).toBeNull();
  } finally {
    await fixture.cleanup();
    await context.close();
  }
});

test('Workout Engine keeps an unsaved result when save-and-complete fails, then retries safely', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page, userId } = await openWorkout(browser);
  const fixture = createWorkoutFixtureScope(page, userId, 'Completion save retry');
  try {
    await fixture.assertNoActiveWorkout();
    const exercise = await fixture.createExercise('Повтор завершения', 'reps');
    await fixture.savePlanV3([{ exerciseId: exercise.id, plannedSets: [{ targetRepsMin: 8, restSeconds: 0 }] }]);
    await openFixturePlan(page, fixture.planName);
    const active = await storedSessionRpc(page, 'get_my_active_workout_session_v3', {});
    expect(active.status).toBe(200);
    const sessionId = (active.data as { id: string }).id;
    fixture.registerSession(active.data as { id: string; title?: string; plan_id?: string | null });

    await page.getByLabel('Повторы').fill('11');
    await page.getByRole('button', { name: 'Начать подход', exact: true }).click();
    await page.getByLabel('Закрыть').click();
    await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Сохранить результат подхода?' });
    await expect(confirmation).toContainText('11 повторений');

    let failOnce = true;
    await page.route('**/rest/v1/rpc/save_my_performed_set', async (route) => {
      if (failOnce) {
        failOnce = false;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporary set failure' }) });
        return;
      }
      await route.continue();
    });
    await confirmation.getByRole('button', { name: 'Сохранить выбранные и завершить', exact: true }).click();
    await expect(confirmation.getByText('Подход не сохранён. Значения остались на экране — повторите отправку.', { exact: true })).toBeVisible();
    await expect(confirmation).toContainText('11 повторений');
    await expect(confirmation.getByRole('button', { name: 'Сохранить выбранные и завершить', exact: true })).toBeEnabled();
    await page.unroute('**/rest/v1/rpc/save_my_performed_set');
    let completionFailsOnce = true;
    await page.route('**/rest/v1/rpc/complete_my_workout_session', async (route) => {
      if (completionFailsOnce) {
        completionFailsOnce = false;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporary completion failure' }) });
        return;
      }
      await route.continue();
    });
    await confirmation.getByRole('button', { name: 'Сохранить выбранные и завершить', exact: true }).click();
    const retryConfirmation = page.getByRole('dialog', { name: 'Не удалось завершить тренировку' });
    await expect(retryConfirmation).toContainText('Сохранённые результаты остаются в тренировке.');
    await expect(retryConfirmation.getByRole('button', { name: 'Повторить завершение', exact: true })).toBeEnabled();
    await page.unroute('**/rest/v1/rpc/complete_my_workout_session');
    await retryConfirmation.getByRole('button', { name: 'Повторить завершение', exact: true }).dblclick();

    await expect.poll(async () => {
      const result = await storedSessionRpc(page, 'get_my_workout_session_v3', { p_session_id: sessionId });
      return (result.data as { status?: string } | null)?.status ?? null;
    }).toBe('completed');
    const completed = await storedSessionRpc(page, 'get_my_workout_session_v3', { p_session_id: sessionId });
    expect((completed.data as { sets: Array<{ reps: number }> }).sets).toEqual([expect.objectContaining({ reps: 11 })]);
    const checkpoint = await storedSessionRpc(page, 'get_my_workout_execution_checkpoint', { p_session_id: sessionId });
    expect(checkpoint.data).toBeNull();
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
    await expect(page.locator('.flux-next-instructions')).toContainText('Примите устойчивый упор. Выполняйте движение плавно, сохраняя ровный темп.');
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

test('Workout Engine V3: duration saves actual time, rest progress and RPE independently', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page, userId, errors } = await openWorkout(browser);
  const fixture = createWorkoutFixtureScope(page, userId, 'Engine V3 duration actual');
  try {
    await fixture.assertNoActiveWorkout();
    const duration = await fixture.createExercise('V3 удержание', 'duration');
    const plan = await fixture.savePlanV3([{ exerciseId: duration.id, plannedSets: [
      { targetDurationSeconds: 5, restSeconds: 6 },
      { targetDurationSeconds: 1, restSeconds: 0 },
      { targetDurationSeconds: 30, restSeconds: 0 },
    ] }]);
    await openFixturePlan(page, fixture.planName);
    const active = await storedSessionRpc(page, 'get_my_active_workout_session_v3', {});
    expect(active.status).toBe(200);
    fixture.registerSession(active.data as { id: string; title?: string; plan_id?: string | null });

    await expect(page.getByRole('timer', { name: /Таймер подхода: 00:00/ })).toBeVisible();
    await page.getByRole('button', { name: 'Начать отсчёт', exact: true }).click();
    await page.waitForTimeout(1_200);
    await page.getByRole('button', { name: 'Пауза', exact: true }).click();
    await expect(page.getByLabel('Фактическая длительность, сек')).not.toBeVisible();
    await page.getByRole('button', { name: 'Изменить время', exact: true }).click();
    const firstDuration = Number(await page.getByLabel('Фактическая длительность, сек').inputValue());
    expect(firstDuration).toBeGreaterThanOrEqual(1);
    expect(firstDuration).toBeLessThan(5);
    await page.waitForTimeout(1_100);
    await expect(page.getByLabel('Фактическая длительность, сек')).toHaveValue(String(firstDuration));
    await page.getByRole('button', { name: 'Тяжело', exact: true }).click();
    await page.getByRole('button', { name: 'Завершить подход', exact: true }).click();

    const restTimer = page.locator('.flux-circular-timer[data-mode="rest"]');
    await expect(restTimer).toBeVisible();
    const initialProgress = await restTimer.getAttribute('data-progress');
    await page.waitForTimeout(1_100);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => restTimer.getAttribute('data-progress')).not.toBe(initialProgress);
    await page.getByRole('button', { name: 'Пропустить отдых', exact: true }).click();

    await page.getByRole('button', { name: 'Начать отсчёт', exact: true }).click();
    await page.waitForTimeout(2_100);
    await expect(page.getByText('цель достигнута', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Пауза', exact: true }).click();
    await expect(page.getByLabel('Фактическая длительность, сек')).not.toBeVisible();
    await page.getByRole('button', { name: 'Изменить время', exact: true }).click();
    const elapsedBeyondPlan = Number(await page.getByLabel('Фактическая длительность, сек').inputValue());
    expect(elapsedBeyondPlan).toBeGreaterThan(1);
    await page.getByLabel('Фактическая длительность, сек').fill('7');
    await page.waitForTimeout(650);
    await expect(page.getByLabel('Фактическая длительность, сек')).toHaveValue('7');
    await page.getByRole('button', { name: 'Завершить подход', exact: true }).click();
    await expect(page.getByLabel('Фактическая длительность, сек')).not.toBeVisible();
    await page.getByRole('button', { name: 'Изменить время', exact: true }).click();
    await page.getByLabel('Фактическая длительность, сек').fill('4');
    await page.waitForTimeout(650);
    await page.getByLabel('Вернуться к тренировкам').click();
    await page.reload(); await settleUi(page); await page.getByRole('button', { name: 'Тренировки', exact: true }).click(); await settleUi(page);
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await expect(page.getByLabel('Фактическая длительность, сек')).toHaveValue('4');
    await page.getByRole('button', { name: 'Завершить подход', exact: true }).click();
    await expect(page.getByText('Тренировка завершена', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Легко', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить тренировку', exact: true }).click();

    // The click schedules an asynchronous completion RPC. Reading immediately
    // can legitimately observe the pre-commit in_progress row, so assert the
    // completed server state rather than racing the user-facing transition.
    let completed: Awaited<ReturnType<typeof storedSessionRpc>> | null = null;
    await expect.poll(async () => {
      const result = await storedSessionRpc(page, 'get_my_workout_session_v3', { p_session_id: (active.data as { id: string }).id });
      completed = result;
      return (result.data as { status?: string } | null)?.status ?? null;
    }).toBe('completed');
    expect(completed).not.toBeNull();
    expect(completed?.status).toBe(200);
    const session = completed?.data as { overall_rpe: number | null; sets: Array<{ set_number: number; duration_seconds: number; rpe: number | null }> };
    expect(session.overall_rpe).toBe(3);
    expect(session.sets).toEqual(expect.arrayContaining([
      expect.objectContaining({ set_number: 1, duration_seconds: firstDuration, rpe: 8 }),
      expect.objectContaining({ set_number: 2, duration_seconds: 7 }),
      expect.objectContaining({ set_number: 3, duration_seconds: 4 }),
    ]));
    await expectNoHorizontalOverflow(page);
    expect(errors()).toEqual([]);
  } finally {
    await fixture.cleanup();
    await context.close();
  }
});

test('Workout Engine checkpoint writes do not race performed-set saves or completion', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page, userId, errors } = await openWorkout(browser);
  const fixture = createWorkoutFixtureScope(page, userId, 'Checkpoint write coordination');
  try {
    await fixture.assertNoActiveWorkout();
    const exercise = await fixture.createExercise('Checkpoint приседания', 'reps');
    await fixture.savePlanV3([{ exerciseId: exercise.id, plannedSets: [
      { targetRepsMin: 8, restSeconds: 0 },
      { targetRepsMin: 10, restSeconds: 0 },
    ] }]);
    await openFixturePlan(page, fixture.planName);
    const active = await storedSessionRpc(page, 'get_my_active_workout_session_v3', {});
    expect(active.status).toBe(200);
    fixture.registerSession(active.data as { id: string; title?: string; plan_id?: string | null });

    // Let initial hydration settle, then hold the next debounced write after it
    // has reached the browser network layer. Saving the set must wait for it.
    await page.waitForTimeout(700);
    let releaseCheckpoint: () => void = () => undefined;
    const checkpointGate = new Promise<void>((resolve) => { releaseCheckpoint = resolve; });
    let markCheckpointStarted: () => void = () => undefined;
    const checkpointStarted = new Promise<void>((resolve) => { markCheckpointStarted = resolve; });
    let checkpointRequests = 0;
    await page.route('**/rest/v1/rpc/save_my_workout_execution_checkpoint', async (route) => {
      checkpointRequests += 1;
      if (checkpointRequests === 1) {
        markCheckpointStarted();
        await checkpointGate;
      }
      await route.continue();
    });

    await page.getByLabel('Повторы').fill('9');
    await checkpointStarted;
    await page.getByRole('button', { name: 'Начать подход', exact: true }).click();
    await page.getByRole('button', { name: 'Завершить подход', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Завершить подход', exact: true })).toBeDisabled();
    releaseCheckpoint();
    await expect(page.getByRole('button', { name: 'Начать подход', exact: true })).toBeVisible();
    await page.unroute('**/rest/v1/rpc/save_my_workout_execution_checkpoint');

    // The saved first set cannot be recreated as a checkpoint. A fresh draft
    // for the second set is valid and proves the coordinator was released.
    await page.waitForTimeout(700);
    const currentCheckpoint = await storedSessionRpc(page, 'get_my_workout_execution_checkpoint', {
      p_session_id: (active.data as { id: string }).id,
    });
    expect(currentCheckpoint.status).toBe(200);
    expect(currentCheckpoint.data).toEqual(expect.objectContaining({ set_number: 2 }));

    await page.getByLabel('Повторы').fill('11');
    await page.getByRole('button', { name: 'Начать подход', exact: true }).click();
    await page.getByRole('button', { name: 'Завершить подход', exact: true }).dblclick();
    await expect(page.getByText('Тренировка завершена', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Легко', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить тренировку', exact: true }).dblclick();

    let completed: Awaited<ReturnType<typeof storedSessionRpc>> | null = null;
    await expect.poll(async () => {
      const result = await storedSessionRpc(page, 'get_my_workout_session_v3', { p_session_id: (active.data as { id: string }).id });
      completed = result;
      return (result.data as { status?: string } | null)?.status ?? null;
    }).toBe('completed');
    expect(completed?.status).toBe(200);
    expect((completed?.data as { sets: Array<{ set_number: number; reps: number }> }).sets).toEqual(expect.arrayContaining([
      expect.objectContaining({ set_number: 1, reps: 9 }),
      expect.objectContaining({ set_number: 2, reps: 11 }),
    ]));
    const checkpointAfterCompletion = await storedSessionRpc(page, 'get_my_workout_execution_checkpoint', {
      p_session_id: (active.data as { id: string }).id,
    });
    expect(checkpointAfterCompletion.status).toBe(200);
    expect(checkpointAfterCompletion.data).toBeNull();
    expect(errors()).toEqual([]);
  } finally {
    await fixture.cleanup();
    await context.close();
  }
});

test('Workout Engine checkpoint persistence resumes after a failed set save and reload', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page, userId } = await openWorkout(browser);
  const fixture = createWorkoutFixtureScope(page, userId, 'Checkpoint save retry');
  try {
    await fixture.assertNoActiveWorkout();
    const exercise = await fixture.createExercise('Checkpoint повтор', 'reps');
    await fixture.savePlanV3([{ exerciseId: exercise.id, plannedSets: [{ targetRepsMin: 8, restSeconds: 0 }] }]);
    await openFixturePlan(page, fixture.planName);
    const active = await storedSessionRpc(page, 'get_my_active_workout_session_v3', {});
    expect(active.status).toBe(200);
    fixture.registerSession(active.data as { id: string; title?: string; plan_id?: string | null });

    let failOnce = true;
    await page.route('**/rest/v1/rpc/save_my_performed_set', async (route) => {
      if (failOnce) {
        failOnce = false;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporary test failure' }) });
        return;
      }
      await route.continue();
    });
    await page.getByLabel('Повторы').fill('12');
    await page.getByRole('button', { name: 'Начать подход', exact: true }).click();
    await page.getByRole('button', { name: 'Завершить подход', exact: true }).click();
    await expect(page.getByText('Подход не сохранён. Значения остались на экране — повторите отправку.', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Повторы')).toHaveValue('12');
    await expect(page.getByText('Черновик сохранён', { exact: true })).toBeVisible({ timeout: 5_000 });
    const checkpointBeforeReload = await storedSessionRpc(page, 'get_my_workout_execution_checkpoint', {
      p_session_id: (active.data as { id: string }).id,
    });
    expect(checkpointBeforeReload.status).toBe(200);
    expect(checkpointBeforeReload.data).toEqual(expect.objectContaining({ draft_reps: 12, phase: 'active' }));

    await page.getByLabel('Вернуться к тренировкам').click();
    await page.reload(); await settleUi(page);
    await page.getByRole('button', { name: 'Тренировки', exact: true }).click(); await settleUi(page);
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await expect(page.getByLabel('Повторы')).toHaveValue('12');
    await page.unroute('**/rest/v1/rpc/save_my_performed_set');
    await page.getByRole('button', { name: 'Завершить подход', exact: true }).click();
    await expect(page.getByText('Тренировка завершена', { exact: true })).toBeVisible();
  } finally {
    await fixture.cleanup();
    await context.close();
  }
});

test('Workout Engine completion retry preserves overall RPE without recreating a checkpoint', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page, userId, errors } = await openWorkout(browser);
  const fixture = createWorkoutFixtureScope(page, userId, 'Checkpoint completion retry');
  try {
    await fixture.assertNoActiveWorkout();
    const exercise = await fixture.createExercise('Checkpoint завершение', 'reps');
    await fixture.savePlanV3([{ exerciseId: exercise.id, plannedSets: [{ targetRepsMin: 8, restSeconds: 0 }] }]);
    await openFixturePlan(page, fixture.planName);
    const active = await storedSessionRpc(page, 'get_my_active_workout_session_v3', {});
    expect(active.status).toBe(200);
    const sessionId = (active.data as { id: string }).id;
    fixture.registerSession(active.data as { id: string; title?: string; plan_id?: string | null });

    await page.getByLabel('Повторы').fill('9');
    await page.getByRole('button', { name: 'Начать подход', exact: true }).click();
    await page.getByRole('button', { name: 'Завершить подход', exact: true }).click();
    await expect(page.getByText('Тренировка завершена', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Нормально', exact: true }).click();

    let failOnce = true;
    await page.route('**/rest/v1/rpc/complete_my_workout_session', async (route) => {
      if (failOnce) {
        failOnce = false;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporary completion failure' }) });
        return;
      }
      await route.continue();
    });
    await page.getByRole('button', { name: 'Сохранить тренировку', exact: true }).click();
    await expect(page.getByText('Не удалось завершить тренировку. Повторите попытку.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Нормально', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Сохранить тренировку', exact: true })).toBeEnabled();
    const checkpointAfterFailure = await storedSessionRpc(page, 'get_my_workout_execution_checkpoint', { p_session_id: sessionId });
    expect(checkpointAfterFailure.status).toBe(200);
    expect(checkpointAfterFailure.data).toBeNull();

    await page.unroute('**/rest/v1/rpc/complete_my_workout_session');
    await page.getByRole('button', { name: 'Сохранить тренировку', exact: true }).click();
    let completed: Awaited<ReturnType<typeof storedSessionRpc>> | null = null;
    await expect.poll(async () => {
      const result = await storedSessionRpc(page, 'get_my_workout_session_v3', { p_session_id: sessionId });
      completed = result;
      return (result.data as { status?: string } | null)?.status ?? null;
    }).toBe('completed');
    expect((completed?.data as { overall_rpe?: number | null }).overall_rpe).toBe(6);
    const checkpointAfterRetry = await storedSessionRpc(page, 'get_my_workout_execution_checkpoint', { p_session_id: sessionId });
    expect(checkpointAfterRetry.status).toBe(200);
    expect(checkpointAfterRetry.data).toBeNull();
    // The only allowed browser-console error is the deliberately intercepted
    // completion request. Any other runtime error remains a test failure.
    const expectedTransportError = 'console: Failed to load resource: the server responded with a status of 503 (Service Unavailable)';
    expect(errors()).toEqual([expectedTransportError]);
  } finally {
    await fixture.cleanup();
    await context.close();
  }
});

async function verifyWorkoutResponsive(browser: import('@playwright/test').Browser, widths: number[]) {
  for (const width of widths) {
    const { context, page, userId, errors } = await openWorkout(browser, width);
    const fixture = createWorkoutFixtureScope(page, userId, `Engine V3 responsive ${width}`);
    try {
      await fixture.assertNoActiveWorkout();
      const exercise = await fixture.createExercise('Мобильные V3 приседания', 'reps');
      await fixture.savePlanV3([{ exerciseId: exercise.id, plannedSets: [
        { targetRepsMin: 8, targetWeightKg: 40, restSeconds: 30 },
        { targetRepsMin: 10, targetWeightKg: 45, restSeconds: 0 },
      ] }]);
      await page.getByRole('button', { name: 'Тренировки', exact: true }).click();
      await settleUi(page);
      await expect(page.getByText('Мои планы', { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.locator('.flux-workout-list-button').filter({ hasText: fixture.planName }).click();
      await settleUi(page);
      await expect(page.getByText('Упражнения', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Активная тренировка' })).toBeVisible();
      const active = await storedSessionRpc(page, 'get_my_active_workout_session_v3', {});
      expect(active.status).toBe(200);
      fixture.registerSession(active.data as { id: string; title?: string; plan_id?: string | null });
      await expect(page.locator('.flux-planned-target')).toContainText('8 повторений · 40 кг');
      await expect(page.getByLabel('Повторы')).toHaveValue('8');
      await expect(page.getByLabel('Вес, кг')).toHaveValue('40');
      await page.getByRole('button', { name: 'Начать подход', exact: true }).click();
      await page.getByRole('button', { name: 'Завершить подход', exact: true }).click();
      const restTimer = page.locator('.flux-circular-timer[data-mode="rest"]');
      await expect(restTimer).toBeVisible();
      await expect(restTimer.locator('.flux-circular-timer-value')).toHaveCSS('font-size', /^(?:3[8-9]|4\d)(?:\.\d+)?px$/);
      await expect(page.getByRole('button', { name: 'Пропустить отдых', exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(errors()).toEqual([]);
    } finally {
      await fixture.cleanup();
      await context.close();
    }
  }
}

test('Workout Engine: 320–375 px has no overflow', async ({ browser }) => {
  await verifyWorkoutResponsive(browser, [320, 375]);
});

test('Workout Engine: 390–430 px has no overflow', async ({ browser }) => {
  await verifyWorkoutResponsive(browser, [390, 430]);
});

test('Workout Engine V3 duration timer: 320–430 px has no overflow', async ({ browser }) => {
  test.setTimeout(120_000);
  for (const width of [320, 375, 390, 430]) {
    const { context, page, userId, errors } = await openWorkout(browser, width);
    const fixture = createWorkoutFixtureScope(page, userId, `Engine V3 duration responsive ${width}`);
    try {
      await fixture.assertNoActiveWorkout();
      const duration = await fixture.createExercise('Мобильное удержание', 'duration');
      await fixture.savePlanV3([{ exerciseId: duration.id, plannedSets: [{ targetDurationSeconds: 30, restSeconds: 0 }] }]);
      await openFixturePlan(page, fixture.planName);
      const active = await storedSessionRpc(page, 'get_my_active_workout_session_v3', {});
      expect(active.status).toBe(200);
      fixture.registerSession(active.data as { id: string; title?: string; plan_id?: string | null });
      await expect(page.getByRole('timer', { name: /Таймер подхода: 00:00/ })).toBeVisible();
      await expect(page.getByText('План · 00:30', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Фактическая длительность, сек')).not.toBeVisible();
      await expect(page.getByRole('button', { name: 'Изменить время', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Начать отсчёт', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Сбросить таймер', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Начать отсчёт', exact: true }).click();
      await expect(page.locator('.flux-base-app > .flux-workout-flow')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Завершить подход', exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(errors()).toEqual([]);
    } finally {
      await fixture.cleanup();
      await context.close();
    }
  }
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
