import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { authenticatedContext, cleanupOwnedSyntheticWorkoutSession, collectRuntime, expectNoHorizontalOverflow, openApp, settleUi, stableScreenshot, storedSessionRpc } from './helpers';

type TrainerLinkRow = { link_id: string; status: string; client_id: string; client_name: string };

async function openTrainerClientWorkouts(browser: import('@playwright/test').Browser, width = 390, clientPersona: 'CLIENT' | 'NUTRITION_E2E_CLIENT' = 'CLIENT') {
  const trainer = await authenticatedContext(browser, 'TRAINER', width, { mobile: width <= 430 });
  // Exercise the assigned-plan execution UI at the same mobile width as the
  // trainer editor. This keeps the V3 client path under the responsive
  // contract instead of accidentally exercising it at a desktop viewport.
  const client = await authenticatedContext(browser, clientPersona, width, { mobile: width <= 430 });
  const links = await storedSessionRpc(trainer.page, 'get_my_trainer_hub', {});
  expect(links.status).toBe(200);
  const link = (links.data as TrainerLinkRow[]).find((item) => item.status === 'active' && item.client_id === client.userId);
  if (!link) throw new Error('FIXTURE STATE BLOCKER: no active synthetic trainer/client link is available.');

  const errors = collectRuntime(trainer.page);
  const httpErrors: string[] = [];
  trainer.page.on('response', (response) => {
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
  });
  await openApp(trainer.page);
  await trainer.page.getByRole('button', { name: 'Клиенты', exact: true }).click();
  const card = trainer.page.locator('.flux-client-card.is-active').filter({ hasText: link.client_name });
  await expect(card).toHaveCount(1);
  await card.locator('.flux-client-card-main').click();
  await trainer.page.getByRole('button', { name: 'Тренировки', exact: true }).last().click();
  await expect(trainer.page.getByRole('heading', { name: 'Планы тренировок', exact: true })).toBeVisible();
  return { ...trainer, client, link, errors, httpErrors };
}

for (const width of [320, 375, 390, 430]) {
test(`Trainer V3 execution: client-safe snapshot preserves per-set plan and actual values at ${width}px`, async ({ browser }) => {
  test.setTimeout(120_000);
  const marker = `[FLUX E2E fixture:${randomUUID()}]`;
  const planName = `${marker} Назначение V2`;
  const privateName = `Тяга тренера ${marker}`;
  const { context, page, userId, client, link, errors, httpErrors } = await openTrainerClientWorkouts(browser, width, 'NUTRITION_E2E_CLIENT');
  let planId: string | null = null;
  let privateExerciseId: string | null = null;
  let clientSessionId: string | null = null;
  let otherContext: import('@playwright/test').BrowserContext | null = null;
  try {
    await page.getByRole('button', { name: 'Создать план', exact: true }).first().click();
    await page.getByLabel('Название плана').fill(planName);
    await page.getByRole('button', { name: 'К упражнениям', exact: true }).click();
    await page.getByRole('button', { name: 'Добавить упражнение', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Добавить упражнение' });
    await picker.getByLabel('Поиск упражнения').fill('Жим штанги лёжа');
    const catalogRow = picker.locator('.flux-catalog-list article').filter({ hasText: 'Жим штанги лёжа' }).first();
    await expect(catalogRow).toBeVisible();
    await catalogRow.getByRole('button', { name: 'Добавить', exact: true }).click();

    await picker.getByRole('tab', { name: 'Мои упражнения', exact: true }).click();
    await picker.getByRole('button', { name: 'Создать упражнение', exact: true }).click();
    await picker.getByLabel('Название упражнения').fill(privateName);
    await picker.getByRole('button', { name: 'Создать и добавить', exact: true }).click();
    await expect(picker.getByText(`«${privateName}» добавлено в черновик.`)).toBeVisible();
    const ownedExercises = await storedSessionRpc(page, 'get_my_exercises', {});
    expect(ownedExercises.status).toBe(200);
    privateExerciseId = ((ownedExercises.data as Array<{ id?: string; name?: string }> | null) ?? [])
      .find((item) => item.name === privateName)?.id ?? null;
    expect(privateExerciseId).toBeTruthy();
    await picker.getByRole('button', { name: 'Закрыть каталог упражнений' }).click();
    await expect(page.locator('.flux-editor-step-list article')).toHaveCount(2);
    await page.getByRole('button', { name: 'Проверить план →', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить план', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Проверка плана' })).toBeHidden();

    await expect.poll(async () => {
      const result = await storedSessionRpc(page, 'get_trainer_assigned_workout_plans', { p_link_id: link.link_id });
      const plan = (result.data as Array<{ id: string; name: string }> | null)?.find((item) => item.name === planName);
      if (!plan) return null;
      planId = plan.id;
      const detail = await storedSessionRpc(page, 'get_trainer_assigned_workout_plan_v3', { p_link_id: link.link_id, p_plan_id: plan.id });
      if (detail.status !== 200 || !detail.data || typeof detail.data !== 'object') return null;
      const steps = (detail.data as { exercises: Array<{ exercise_source_kind?: string; exercise_source_id?: string; name?: string }> }).exercises;
      const trainerPrivate = steps.find((item) => item.name === privateName);
      return steps.some((item) => item.exercise_source_kind === 'catalog' && Boolean(item.exercise_source_id))
        && trainerPrivate?.exercise_source_kind === 'trainer_private' && trainerPrivate.exercise_source_id === privateExerciseId;
    }).toBe(true);

    // Materialize distinct V3 planned sets before the client starts. The test
    // later mutates the plan again to prove the active snapshot stays immutable.
    await page.getByLabel(`Редактировать ${planName}`).click();
    await page.getByRole('button', { name: 'К упражнениям', exact: true }).click();
    await page.getByLabel(`Раскрыть ${privateName}`).click();
    await page.getByLabel('Повторы, подход 1').fill('8');
    await page.getByLabel('Вес, подход 1').fill('40');
    await page.getByLabel('Отдых: минуты, подход 1').fill('0');
    await page.getByLabel('Отдых: секунды, подход 1').fill('25');
    await page.getByRole('button', { name: 'Добавить подход', exact: true }).click();
    await page.getByLabel('Повторы, подход 2').fill('12');
    await page.getByLabel('Вес, подход 2').fill('45');
    await page.getByLabel('Отдых: минуты, подход 2').fill('0');
    await page.getByLabel('Отдых: секунды, подход 2').fill('0');
    await page.getByRole('button', { name: 'Проверить план →', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить план', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Проверка плана' })).toBeHidden();
    const configured = await storedSessionRpc(page, 'get_trainer_assigned_workout_plan_v3', { p_link_id: link.link_id, p_plan_id: planId });
    expect(configured.status).toBe(200);
    const configuredPrivate = (configured.data as { exercises: Array<{ name?: string; planned_sets?: Array<{ set_id?: string | null; set_number?: number; target_reps_min?: number; target_weight_kg?: number; rest_seconds?: number }> }> }).exercises.find((item) => item.name === privateName);
    expect(configuredPrivate?.planned_sets).toEqual([
      expect.objectContaining({ set_number: 1, target_reps_min: 8, target_weight_kg: 40, rest_seconds: 25 }),
      expect.objectContaining({ set_number: 2, target_reps_min: 12, target_weight_kg: 45, rest_seconds: 0 }),
    ]);
    expect(configuredPrivate?.planned_sets?.every((set) => Boolean(set.set_id))).toBe(true);

    const clientDetail = await storedSessionRpc(client.page, 'get_my_workout_plan_v3', { p_plan_id: planId });
    expect(clientDetail.status).toBe(200);
    const clientTrainerStep = (clientDetail.data as { exercises: Array<{ name?: string; exercise_source_id?: string | null }> }).exercises.find((item) => item.name === privateName);
    // Client-safe V3 reads omit the trainer-private source identity entirely;
    // accepting null here would also allow an accidental disclosure-shaped field.
    expect(clientTrainerStep).not.toHaveProperty('exercise_source_id');

    // The client starts the same trainer-assigned V3 plan through the shared
    // execution entry point. Its snapshot must preserve planned sets but not
    // the trainer-private exercise UUID.
    await openApp(client.page);
    const existingActive = await storedSessionRpc(client.page, 'get_my_active_workout_session_v3', {});
    if (existingActive.status !== 200 || existingActive.data) {
      throw new Error('FIXTURE STATE BLOCKER: CLIENT has a pre-existing active workout. No foreign session was changed.');
    }
    await client.page.getByRole('button', { name: 'Тренировки', exact: true }).click();
    await settleUi(client.page);
    await client.page.locator('.flux-workout-list-button').filter({ hasText: planName }).click();
    await settleUi(client.page);
    const clientPlanViewer = client.page.getByRole('dialog', { name: planName });
    const openPrivateExercise = clientPlanViewer.getByRole('button', { name: `Открыть ${privateName}` });
    await openPrivateExercise.click();
    const clientExerciseDetail = client.page.getByRole('dialog', { name: privateName });
    await expect(clientExerciseDetail.getByText('8 повторений · 40 кг', { exact: true })).toBeVisible();
    await expect(clientExerciseDetail.getByText('Отдых 00:25', { exact: true })).toBeVisible();
    await expect(clientExerciseDetail.getByRole('button', { name: 'Редактировать упражнение', exact: true })).toHaveCount(0);
    expect(await clientExerciseDetail.textContent()).not.toContain(privateExerciseId!);
    await expectNoHorizontalOverflow(client.page);
    await stableScreenshot(client.page, `test-results/plan-viewer-v3-${width}.png`);
    await client.page.getByRole('button', { name: 'Назад к плану' }).click();
    await expect(openPrivateExercise).toBeFocused();
    await client.page.getByRole('button', { name: 'Начать тренировку', exact: true }).click();
    await expect(client.page.getByRole('dialog', { name: 'Активная тренировка' })).toBeVisible();
    const execution = await storedSessionRpc(client.page, 'get_my_active_workout_session_v3', {});
    expect(execution.status).toBe(200);
    clientSessionId = (execution.data as { id?: string }).id ?? null;
    expect(clientSessionId).toBeTruthy();
    expect(execution.data).toMatchObject({ plan_id: planId, title: planName });
    const clientSnapshot = execution.data as { plan_snapshot: Array<{ name?: string; exercise_source_id?: string; exercise_snapshot?: { source_id?: string }; planned_sets?: unknown[] }> };
    const privateSnapshot = clientSnapshot.plan_snapshot.find((item) => item.name === privateName);
    expect(privateSnapshot).toBeTruthy();
    expect(privateSnapshot).not.toHaveProperty('exercise_source_id');
    expect(privateSnapshot?.exercise_snapshot).not.toHaveProperty('source_id');
    expect(privateSnapshot?.planned_sets).toEqual([
      expect.objectContaining({ set_number: 1, target_reps_min: 8, target_weight_kg: 40, rest_seconds: 25 }),
      expect.objectContaining({ set_number: 2, target_reps_min: 12, target_weight_kg: 45, rest_seconds: 0 }),
    ]);
    await expectNoHorizontalOverflow(client.page);

    // Complete the catalog set with actual values that differ from its plan,
    // then move to the trainer-private source using only client-safe data.
    await client.page.getByLabel('Повторы').fill('7');
    await client.page.getByRole('button', { name: 'Начать подход', exact: true }).click();
    await client.page.getByRole('button', { name: 'Тяжело', exact: true }).click();
    await client.page.getByRole('button', { name: 'Завершить подход', exact: true }).click();
    await expect(client.page.getByText('Можно выдохнуть', { exact: true })).toBeVisible();
    await client.page.getByRole('button', { name: 'Пропустить отдых', exact: true }).click();
    await client.page.getByRole('button', { name: 'Перейти к упражнению', exact: true }).click();
    await expect(client.page.locator('.flux-planned-target')).toContainText('8 повторений · 40 кг');
    await client.page.getByLabel('Повторы').fill('7');
    await client.page.getByLabel('Вес, кг').fill('37.5');
    await client.page.getByRole('button', { name: 'Начать подход', exact: true }).click();
    await client.page.getByRole('button', { name: 'Завершить подход', exact: true }).click();
    await expect(client.page.getByText('Можно выдохнуть', { exact: true })).toBeVisible();

    // The next trainer-private set must have a durable, client-safe draft
    // before a reload. It is owned by the client session and never exposes
    // the trainer-private source UUID.
    await expect.poll(async () => {
      const checkpoint = await storedSessionRpc(client.page, 'get_my_workout_execution_checkpoint', {
        p_session_id: clientSessionId,
      });
      return checkpoint.status === 200 ? checkpoint.data : null;
    }).toEqual(expect.objectContaining({
      set_number: 2,
      draft_reps: 12,
      draft_weight_kg: 45,
    }));

    // An editor save after session start may change the plan, but cannot rewrite
    // the active V3 snapshot the client will resume.
    await client.page.getByLabel('Вернуться к тренировкам').click();
    await page.getByLabel(`Редактировать ${planName}`).click();
    await page.getByRole('button', { name: 'К упражнениям', exact: true }).click();
    await page.getByLabel(`Раскрыть ${privateName}`).click();
    await page.getByLabel('Повторы, подход 1').fill('99');
    await page.getByRole('button', { name: 'Проверить план →', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить план', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Проверка плана' })).toBeHidden();
    const edited = await storedSessionRpc(page, 'get_trainer_assigned_workout_plan_v3', { p_link_id: link.link_id, p_plan_id: planId });
    expect(edited.status).toBe(200);
    const editedPrivate = (edited.data as { exercises: Array<{ name?: string; planned_sets?: Array<{ target_reps_min?: number }> }> }).exercises.find((item) => item.name === privateName);
    expect(editedPrivate?.planned_sets?.[0]).toMatchObject({ target_reps_min: 99 });

    await client.page.reload(); await settleUi(client.page);
    await client.page.getByRole('button', { name: 'Тренировки', exact: true }).click(); await settleUi(client.page);
    await client.page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await expect(client.page.locator('.flux-planned-target')).toContainText('12 повторений · 45 кг');
    await expect(client.page.getByLabel('Повторы')).toHaveValue('12');
    await expect(client.page.getByLabel('Вес, кг')).toHaveValue('45');
    await client.page.getByRole('button', { name: 'Начать подход', exact: true }).click();
    await client.page.getByRole('button', { name: 'Завершить подход', exact: true }).click();
    await expect(client.page.getByText('Тренировка завершена', { exact: true })).toBeVisible();
    await client.page.getByRole('button', { name: 'Легко', exact: true }).click();
    await client.page.getByRole('button', { name: 'Сохранить тренировку', exact: true }).click();
    let completed: Awaited<ReturnType<typeof storedSessionRpc>> | null = null;
    await expect.poll(async () => {
      const result = await storedSessionRpc(client.page, 'get_my_workout_session_v3', { p_session_id: clientSessionId });
      completed = result;
      return (result.data as { status?: string } | null)?.status ?? null;
    }).toBe('completed');
    expect(completed?.status).toBe(200);
    const completedSession = completed?.data as { overall_rpe?: number | null; sets?: Array<{ reps?: number; weight_kg?: number; rpe?: number | null }> } | null;
    expect(completedSession?.overall_rpe).toBe(3);
    const performed = completedSession?.sets ?? [];
    expect(performed).toEqual(expect.arrayContaining([
      expect.objectContaining({ reps: 7, rpe: 8 }),
      expect.objectContaining({ reps: 7, weight_kg: 37.5 }),
      expect.objectContaining({ reps: 12, weight_kg: 45 }),
    ]));
    const checkpointAfterCompletion = await storedSessionRpc(client.page, 'get_my_workout_execution_checkpoint', {
      p_session_id: clientSessionId,
    });
    expect(checkpointAfterCompletion.status).toBe(200);
    expect(checkpointAfterCompletion.data).toBeNull();
    await expect(client.page.locator('.flux-workout-history-button').filter({ hasText: planName })).toBeVisible();

    const other = await authenticatedContext(browser, 'OTHER_TRAINER');
    otherContext = other.context;
    const foreignRead = await storedSessionRpc(other.page, 'get_trainer_assigned_workout_plan_v3', { p_link_id: link.link_id, p_plan_id: planId });
    expect(foreignRead.status).not.toBe(200);

    expect(errors()).toEqual([]); expect(httpErrors).toEqual([]);
  } finally {
    await otherContext?.close();
    if (clientSessionId) await cleanupOwnedSyntheticWorkoutSession(client.userId, clientSessionId, planName);
    if (planId) {
      const deleted = await storedSessionRpc(page, 'delete_trainer_assigned_workout_plan_v3', { p_link_id: link.link_id, p_plan_id: planId });
      expect(deleted.status).toBe(204);
    }
    if (privateExerciseId) {
      const deleted = await storedSessionRpc(page, 'delete_my_exercise', { p_exercise_id: privateExerciseId });
      expect(deleted.status).toBe(204);
    }
    await client.context.close();
    await context.close();
  }
});
}

test('Trainer Plan Editor V2: Visual Set Editor fits mobile widths', async ({ browser }) => {
  const { context, page, client } = await openTrainerClientWorkouts(browser, 320);
  try {
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole('button', { name: 'Создать план', exact: true }).first().click();
      await page.getByRole('button', { name: 'К упражнениям', exact: true }).click();
      await page.getByRole('button', { name: 'Добавить упражнение', exact: true }).click();
      const picker = page.getByRole('dialog', { name: 'Добавить упражнение' });
      await expect(picker).toBeVisible();
      await picker.getByLabel('Поиск упражнения').fill('Жим штанги лёжа');
      const exercise = picker.locator('.flux-catalog-list article').filter({ hasText: 'Жим штанги лёжа' }).first();
      await expect(exercise).toBeVisible();
      await exercise.getByRole('button', { name: 'Добавить', exact: true }).click();
      await picker.getByRole('button', { name: 'Закрыть каталог упражнений' }).click();
      await page.getByLabel('Раскрыть Жим штанги лёжа').click();
      await page.getByLabel('Повторы, подход 1').fill('8');
      await page.getByLabel('Вес, подход 1').fill('25.5');
      await page.getByLabel('Отдых: минуты, подход 1').fill('0');
      await page.getByLabel('Отдых: секунды, подход 1').fill('45');
      await page.getByRole('button', { name: 'Добавить подход', exact: true }).click();
      await expect(page.getByLabel('Вес, подход 2')).toHaveValue('25.5');
      await page.getByLabel('Удалить подход 2').click();
      await page.getByRole('button', { name: 'Отменить', exact: true }).click();
      await expect(page.getByLabel('Вес, подход 2')).toHaveValue('25.5');
      await expectNoHorizontalOverflow(page);
      await stableScreenshot(page, `test-results/trainer-visual-set-editor-${width}.png`);
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    }
  } finally {
    await client.context.close();
    await context.close();
  }
});
