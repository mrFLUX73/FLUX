import { expect, test } from '@playwright/test';
import { authenticatedContext, collectRuntime, createWorkoutFixtureScope, expectNoHorizontalOverflow, openApp, settleUi, stableScreenshot, storedSessionRpc } from './helpers';

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
    const exercises = await Promise.all([
      fixture.createExercise('Присед', 'reps'),
      fixture.createExercise('Планка', 'duration'),
      fixture.createExercise('Бег', 'distance'),
    ]);
    await page.getByRole('button', { name: 'Создать план', exact: true }).click();
    await page.getByLabel('Название плана').fill(fixture.planName);
    await page.getByLabel('Описание').fill(fixture.description);
    await page.getByRole('button', { name: 'К упражнениям', exact: true }).click();
    await page.getByRole('button', { name: 'Добавить упражнение', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Добавить упражнение' });
    await expect(picker).toBeVisible();
    await picker.getByRole('tab', { name: 'Мои упражнения', exact: true }).click();
    for (const [index, exercise] of exercises.entries()) {
      const row = picker.locator('.flux-catalog-list article').filter({ hasText: exercise.name });
      await row.getByRole('button', { name: 'Добавить', exact: true }).click();
      await expect(page.locator('.flux-editor-step-list article')).toHaveCount(index + 1);
    }
    await picker.getByRole('button', { name: 'Закрыть каталог упражнений' }).click();
    await page.getByLabel('Выше').last().click();
    await page.getByLabel(`Раскрыть ${exercises[2].name}`).click();
    await page.getByLabel('Дистанция, подход 1').fill('1500');
    await page.getByLabel('Отдых, подход 1').fill('45');
    await page.getByRole('button', { name: 'К проверке', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить план', exact: true }).click();
    await expect(page.getByText(fixture.planName, { exact: true }).first()).toBeVisible();
    await expect.poll(async () => {
      const result = await storedSessionRpc(page, 'get_my_workout_plans', {});
      if (result.status !== 200 || !Array.isArray(result.data)) return false;
      const plan = result.data.find((item) => (item as { name?: string }).name === fixture.planName) as { id?: string; name?: string } | undefined;
      if (!plan?.id) return false;
      fixture.registerPlan({ id: plan.id, name: plan.name });
      const detail = await storedSessionRpc(page, 'get_my_workout_plan_v3', { p_plan_id: plan.id });
      if (detail.status !== 200 || !detail.data || typeof detail.data !== 'object') return false;
      const savedExercises = (detail.data as { exercises?: Array<{ exercise_source_kind?: string; exercise_source_id?: string; name?: string }> }).exercises ?? [];
      return savedExercises.length === 3 && savedExercises.every((exercise) => exercise.exercise_source_kind === 'personal' && Boolean(exercise.exercise_source_id) && Boolean(exercise.name));
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
    const active = await storedSessionRpc(page, 'get_my_active_workout_session', {});
    if (active.status === 200 && active.data && typeof active.data === 'object' && 'id' in active.data) {
      const session = active.data as { id: string; title?: string; plan_id?: string | null };
      if (session.title === fixture.planName && session.plan_id) fixture.registerSession(session);
    }
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
  const deleted = await storedSessionRpc(clientPage, 'delete_my_workout_plan_v3', { p_plan_id: copyId });
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

test('Personal Plan Editor V2: catalog picker searches, filters, paginates and keeps its draft', async ({ browser }) => {
  const { context, page, errors, httpErrors } = await openWorkouts(browser);
  const queries: Array<Record<string, unknown>> = [];
  const catalogRows = Array.from({ length: 20 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    slug: `e2e-catalog-${index + 1}`,
    name: `Тяга E2E ${index + 1}`,
    measurement_type: 'reps',
    technique_description: 'Контролируйте движение и сохраняйте нейтральную спину.',
    primary_muscle_group_slug: 'back',
    primary_muscle_group_name_ru: 'Спина',
  }));
  await page.route('**/rest/v1/muscle_groups*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ slug: 'back', name_ru: 'Спина' }]) }));
  await page.route('**/rest/v1/equipment*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ slug: 'barbell', name_ru: 'Штанга' }]) }));
  await page.route('**/rest/v1/rpc/search_exercise_catalog_v1', (route) => {
    queries.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(catalogRows) });
  });
  await page.route('**/rest/v1/exercise_catalog_equipment*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(catalogRows.map((item) => ({ catalog_exercise_id: item.id, equipment: { name_ru: 'Штанга' } }))) }));
  try {
    await page.getByRole('button', { name: 'Создать план', exact: true }).click();
    await page.getByLabel('Название плана').fill('Каталог E2E');
    await page.getByRole('button', { name: 'К упражнениям', exact: true }).click();
    await page.getByRole('button', { name: 'Добавить упражнение', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Добавить упражнение' });
    await expect(picker.locator('.flux-catalog-list article')).toHaveCount(20);
    await picker.getByLabel('Поиск упражнения').fill('Румынская тяга');
    await expect.poll(() => queries.some((query) => query.p_query === 'Румынская тяга')).toBe(true);
    await picker.getByLabel('Мышцы').selectOption('back');
    await picker.getByLabel('Оборудование').selectOption('barbell');
    await expect.poll(() => queries.some((query) => query.p_muscle_group_slug === 'back' && query.p_equipment_slug === 'barbell')).toBe(true);
    await picker.getByRole('button', { name: 'Далее', exact: true }).click();
    await expect.poll(() => queries.some((query) => query.p_offset === 20)).toBe(true);
    const first = picker.locator('.flux-catalog-list article').first();
    await first.getByText('Техника выполнения', { exact: true }).click();
    await expect(first.getByText('Контролируйте движение и сохраняйте нейтральную спину.')).toBeVisible();
    await first.getByRole('button', { name: 'Добавить', exact: true }).dblclick();
    await expect(first.getByText('В черновике', { exact: true })).toBeVisible();
    await picker.getByRole('button', { name: 'Закрыть каталог упражнений' }).click();
    await expect(page.locator('.flux-editor-step-list article')).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
    expect(errors()).toEqual([]); expect(httpErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Personal Plan Editor V2: quick personal creation adds every measurement type and preserves owner isolation', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page, userId, errors, httpErrors } = await openWorkouts(browser);
  const fixture = createWorkoutFixtureScope(page, userId, 'Quick personal exercise');
  let otherContext: import('@playwright/test').BrowserContext | null = null;
  try {
    await fixture.assertNoActiveWorkout();
    await page.getByRole('button', { name: 'Создать план', exact: true }).click();
    await page.getByLabel('Название плана').fill(fixture.planName);
    await page.getByLabel('Описание').fill(fixture.description);
    await page.getByRole('button', { name: 'К упражнениям', exact: true }).click();
    await page.getByRole('button', { name: 'Добавить упражнение', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Добавить упражнение' });
    await picker.getByRole('tab', { name: 'Мои упражнения', exact: true }).click();

    const create = async (name: string, measurement: 'Повторения' | 'Время' | 'Дистанция') => {
      await picker.getByRole('button', { name: 'Создать упражнение', exact: true }).click();
      await expect(picker.getByRole('button', { name: 'Создать и добавить', exact: true })).toBeDisabled();
      await picker.getByLabel('Название упражнения').fill(name);
      if (measurement !== 'Повторения') await picker.getByRole('button', { name: measurement, exact: true }).click();
      await picker.getByLabel('Основная мышечная группа').selectOption('back');
      await picker.getByLabel('Оборудование упражнения').selectOption('barbell');
      await picker.getByLabel('Техника выполнения').fill('Контролируйте движение.');
      await picker.getByRole('button', { name: 'Создать и добавить', exact: true }).dblclick();
      await expect(picker.getByText(`«${name}» добавлено в черновик.`)).toBeVisible();
    };

    const reps = fixture.exerciseName('Тяга резинки');
    const duration = fixture.exerciseName('Вис на турнике');
    const distance = fixture.exerciseName('Интервальный бег');
    await create(reps, 'Повторения');
    await expect(page.locator('.flux-editor-step-list article')).toHaveCount(1);
    await create(duration, 'Время');
    await expect(page.locator('.flux-editor-step-list article')).toHaveCount(2);
    await create(distance, 'Дистанция');
    await expect(page.locator('.flux-editor-step-list article')).toHaveCount(3);

    await picker.getByRole('button', { name: 'Создать упражнение', exact: true }).click();
    await picker.getByLabel('Название упражнения').fill(`  ${reps}  `);
    await expect(picker.getByText(`У вас уже есть «${reps}».`)).toBeVisible();
    await picker.getByRole('button', { name: 'Использовать существующее', exact: true }).click();
    await expect(page.locator('.flux-editor-step-list article')).toHaveCount(4);

    const library = await storedSessionRpc(page, 'get_my_exercises', {});
    expect(library.status).toBe(200);
    const created = (library.data as Array<{ id: string; name: string; measurement_type: string; equipment?: string[]; primary_muscles?: string[] }>).filter((item) => item.name.endsWith(` ${fixture.marker}`));
    expect(created).toHaveLength(3);
    expect(created.map((item) => item.measurement_type).sort()).toEqual(['distance', 'duration', 'reps']);
    expect(created.every((item) => item.equipment?.includes('Штанга') && item.primary_muscles?.includes('Спина'))).toBe(true);
    created.forEach((item) => fixture.registerExercise(item));

    const other = await authenticatedContext(browser, 'OTHER_TRAINER');
    otherContext = other.context;
    const foreignLibrary = await storedSessionRpc(other.page, 'get_my_exercises', {});
    expect(foreignLibrary.status).toBe(200);
    expect((foreignLibrary.data as Array<{ name?: string }>).some((item) => item.name?.includes(fixture.marker))).toBe(false);

    await picker.getByRole('button', { name: 'Закрыть каталог упражнений' }).click();
    await page.getByRole('button', { name: 'К проверке', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить план', exact: true }).click();
    await expect.poll(async () => {
      const result = await storedSessionRpc(page, 'get_my_workout_plans', {});
      if (result.status !== 200 || !Array.isArray(result.data)) return null;
      return result.data.find((item) => (item as { name?: string }).name === fixture.planName) as { id?: string; name?: string } | null;
    }).not.toBeNull();
    const saved = await storedSessionRpc(page, 'get_my_workout_plans', {});
    const plan = (saved.data as Array<{ id: string; name?: string }>).find((item) => item.name === fixture.planName)!;
    fixture.registerPlan(plan);
    const detail = await storedSessionRpc(page, 'get_my_workout_plan_v3', { p_plan_id: plan.id });
    expect(detail.status).toBe(200);
    const steps = (detail.data as { exercises: Array<{ exercise_source_kind?: string; exercise_source_id?: string }> }).exercises;
    expect(steps).toHaveLength(4);
    expect(steps.every((step) => step.exercise_source_kind === 'personal' && created.some((item) => item.id === step.exercise_source_id))).toBe(true);
    expect(errors()).toEqual([]); expect(httpErrors).toEqual([]);
  } finally {
    await otherContext?.close();
    await fixture.cleanup();
    await context.close();
  }
});

test('Personal Plan Editor V2: quick personal creation retains values after a server error', async ({ browser }) => {
  const { context, page, errors, httpErrors } = await openWorkouts(browser);
  try {
    await page.getByRole('button', { name: 'Создать план', exact: true }).click();
    await page.getByLabel('Название плана').fill('Ошибка создания E2E');
    await page.getByRole('button', { name: 'К упражнениям', exact: true }).click();
    await page.getByRole('button', { name: 'Добавить упражнение', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Добавить упражнение' });
    await picker.getByRole('tab', { name: 'Мои упражнения', exact: true }).click();
    await picker.getByRole('button', { name: 'Создать упражнение', exact: true }).click();
    await page.route('**/rest/v1/exercises*', (route) => route.request().method() === 'POST'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'E2E forced error' }) })
      : route.continue());
    await picker.getByLabel('Название упражнения').fill('Ошибка сети E2E');
    await picker.getByRole('button', { name: 'Создать и добавить', exact: true }).click();
    await expect(picker.getByRole('alert')).toHaveText('Не удалось создать упражнение. Проверьте соединение и повторите — данные формы сохранены.');
    await expect(picker.getByLabel('Название упражнения')).toHaveValue('Ошибка сети E2E');
    await expect(page.locator('.flux-editor-step-list article')).toHaveCount(0);
    expect(errors().filter((message) => !message.includes('status of 500'))).toEqual([]);
    expect(httpErrors.filter((url) => !url.includes('/rest/v1/exercises'))).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Personal Plan Editor V2: published catalog exercise saves, starts and keeps source identity', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page, userId, errors, httpErrors } = await openWorkouts(browser);
  const fixture = createWorkoutFixtureScope(page, userId, 'Production catalog');
  try {
    await fixture.assertNoActiveWorkout();
    await page.getByRole('button', { name: 'Создать план', exact: true }).click();
    await page.getByLabel('Название плана').fill(fixture.planName);
    await page.getByLabel('Описание').fill(fixture.description);
    await page.getByRole('button', { name: 'К упражнениям', exact: true }).click();
    await page.getByRole('button', { name: 'Добавить упражнение', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Добавить упражнение' });
    await expect(picker).toBeVisible();
    await picker.getByLabel('Поиск упражнения').fill('RDL');
    const row = picker.locator('.flux-catalog-list article').filter({ hasText: 'Румынская тяга со штангой' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Добавить', exact: true }).click();
    await picker.getByRole('button', { name: 'Закрыть каталог упражнений' }).click();
    await page.getByRole('button', { name: 'К проверке', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить план', exact: true }).click();

    const plan = await expect.poll(async () => {
      const result = await storedSessionRpc(page, 'get_my_workout_plans', {});
      if (result.status !== 200 || !Array.isArray(result.data)) return null;
      return result.data.find((item) => (item as { name?: string }).name === fixture.planName) as { id?: string; name?: string } | null;
    }).not.toBeNull();
    const plans = await storedSessionRpc(page, 'get_my_workout_plans', {});
    const savedPlan = (plans.data as Array<{ id: string; name?: string }>).find((item) => item.name === fixture.planName)!;
    fixture.registerPlan(savedPlan);
    const detail = await storedSessionRpc(page, 'get_my_workout_plan_v3', { p_plan_id: savedPlan.id });
    expect(detail.status).toBe(200);
    const savedStep = (detail.data as { exercises: Array<{ exercise_source_kind?: string; exercise_source_id?: string; name?: string }> }).exercises[0];
    expect(savedStep).toMatchObject({ exercise_source_kind: 'catalog', name: 'Румынская тяга со штангой' });
    expect(savedStep.exercise_source_id).toBeTruthy();

    await page.reload(); await settleUi(page); await page.getByRole('button', { name: 'Тренировки', exact: true }).click(); await settleUi(page);
    await page.locator('.flux-workout-list-button').filter({ hasText: fixture.planName }).first().click(); await settleUi(page);
    await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Активная тренировка' })).toBeVisible();
    await expect.poll(async () => {
      const result = await storedSessionRpc(page, 'get_my_active_workout_session', {});
      return result.status === 200 && result.data && typeof result.data === 'object' && 'id' in result.data;
    }).toBe(true);
    const active = await storedSessionRpc(page, 'get_my_active_workout_session', {});
    expect(active.status).toBe(200); fixture.registerSession(active.data as { id: string; title?: string; plan_id?: string | null });
    const activeSession = await storedSessionRpc(page, 'get_my_workout_session_v2', { p_session_id: (active.data as { id: string }).id });
    expect(activeSession.status).toBe(200);
    const sessionData = activeSession.data as { id: string; plan_snapshot: Array<{ step_id: string; exercise_source_kind?: string; exercise_source_id?: string }> };
    expect(sessionData.plan_snapshot[0]).toMatchObject({ exercise_source_kind: 'catalog', exercise_source_id: savedStep.exercise_source_id });
    const savedSet = await storedSessionRpc(page, 'save_my_performed_set_v2', {
      p_session_id: sessionData.id, p_client_set_key: crypto.randomUUID(), p_session_step_id: sessionData.plan_snapshot[0].step_id,
      p_set_number: 1, p_reps: 8, p_weight_kg: null, p_duration_seconds: null, p_distance_m: null, p_rpe: null, p_notes: null,
    });
    expect(savedSet.status).toBe(200);
    const completed = await storedSessionRpc(page, 'complete_my_workout_session', { p_session_id: sessionData.id, p_overall_rpe: null, p_notes: null });
    expect(completed.status).toBe(200);
    const history = await storedSessionRpc(page, 'get_my_workout_history', { p_limit: 10 });
    expect(history.status).toBe(200);
    expect((history.data as Array<{ id: string }>).some((session) => session.id === sessionData.id)).toBe(true);
    expect(errors()).toEqual([]); expect(httpErrors).toEqual([]);
  } finally {
    await fixture.cleanup();
    await context.close();
  }
});

test('Personal Plan Editor: editor fits 320–430 px', async ({ browser }) => {
  for (const width of [320, 375, 390, 430]) {
    const { context, page, errors, httpErrors } = await openWorkouts(browser, 'WORKOUT_E2E_CLIENT', width);
    const catalogItem = { id: '00000000-0000-4000-8000-000000000001', slug: 'e2e-mobile-catalog', name: 'Тяга к поясу в наклоне', measurement_type: 'reps', technique_description: 'Тестовая техника.', primary_muscle_group_slug: 'back', primary_muscle_group_name_ru: 'Спина' };
    await page.route('**/rest/v1/muscle_groups*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ slug: 'back', name_ru: 'Спина' }]) }));
    await page.route('**/rest/v1/equipment*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ slug: 'barbell', name_ru: 'Штанга' }]) }));
    await page.route('**/rest/v1/rpc/search_exercise_catalog_v1', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([catalogItem]) }));
    await page.route('**/rest/v1/exercise_catalog_equipment*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ catalog_exercise_id: catalogItem.id, equipment: { name_ru: 'Штанга' } }]) }));
    await page.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Создать план' })).toBeVisible();
    await expect(page.getByLabel('Название плана')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole('button', { name: 'К упражнениям', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Добавить упражнение', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Добавить упражнение', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Добавить упражнение' });
    await expect(picker).toBeVisible();
    await expect(picker.getByText(catalogItem.name, { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await stableScreenshot(page, `test-results/catalog-picker-${width}.png`);
    await picker.getByRole('tab', { name: 'Мои упражнения', exact: true }).click();
    await picker.getByRole('button', { name: 'Создать упражнение', exact: true }).click();
    await expect(picker.getByLabel('Название упражнения')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await stableScreenshot(page, `test-results/personal-exercise-create-${width}.png`);
    expect(errors()).toEqual([]); expect(httpErrors).toEqual([]);
    await context.close();
  }
});

test('Personal Plan Editor: Visual Set Editor keeps inline targets usable from 320 to 430 px', async ({ browser }) => {
  test.setTimeout(90_000);
  const owner = await authenticatedContext(browser, 'WORKOUT_E2E_CLIENT');
  const fixture = createWorkoutFixtureScope(owner.page, owner.userId, 'Visual set editor mobile');
  try {
    await fixture.assertNoActiveWorkout();
    const exercise = await fixture.createExercise('Мобильный жим', 'reps');

    for (const width of [320, 375, 390, 430]) {
      const { context, page, errors, httpErrors } = await openWorkouts(browser, 'WORKOUT_E2E_CLIENT', width);
      try {
        await page.getByRole('button', { name: 'Создать', exact: true }).click();
        await page.getByLabel('Название плана').fill(`Мобильный черновик ${width}`);
        await page.getByRole('button', { name: 'К упражнениям', exact: true }).click();
        await page.getByRole('button', { name: 'Добавить упражнение', exact: true }).click();
        const picker = page.getByRole('dialog', { name: 'Добавить упражнение' });
        await picker.getByRole('tab', { name: 'Мои упражнения', exact: true }).click();
        const row = picker.locator('.flux-catalog-list article').filter({ hasText: exercise.name });
        await expect(row).toBeVisible();
        await row.getByRole('button', { name: 'Добавить', exact: true }).click();
        await picker.getByRole('button', { name: 'Закрыть каталог упражнений' }).click();

        await page.getByLabel(`Раскрыть ${exercise.name}`).click();
        await page.getByLabel('Повторы, подход 1').fill('8');
        await page.getByLabel('Вес, подход 1').fill('25.5');
        await page.getByLabel('Отдых, подход 1').fill('45');
        await page.getByRole('button', { name: 'Добавить подход', exact: true }).click();
        await expect(page.getByLabel('Повторы, подход 2')).toHaveValue('8');
        await expect(page.getByLabel('Вес, подход 2')).toHaveValue('25.5');
        await expect(page.getByLabel('Отдых, подход 2')).toHaveValue('45');
        await page.getByLabel('Удалить подход 2').click();
        await page.getByRole('button', { name: 'Отменить', exact: true }).click();
        await expect(page.getByLabel('Повторы, подход 2')).toHaveValue('8');
        await expectNoHorizontalOverflow(page);
        await stableScreenshot(page, `test-results/visual-set-editor-${width}.png`);
        expect(errors()).toEqual([]); expect(httpErrors).toEqual([]);
      } finally {
        await context.close();
      }
    }
  } finally {
    await fixture.cleanup();
    await owner.context.close();
  }
});
