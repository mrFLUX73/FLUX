// Test-owned Workout fixtures use a per-run UUID marker in both the plan name
// and description. This is deliberately narrower than a persona-wide reset:
// every candidate is re-validated against the server-side synthetic registry
// before an exact-ID delete is issued.
const markerPattern = /^\[FLUX E2E fixture:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]$/i;

function fail(message) {
  throw new Error(`E2E fixture hygiene: ${message}`);
}

export async function cleanInterruptedWorkoutFixtures(admin, syntheticUserIds, ownerClients) {
  const ids = [...new Set(syntheticUserIds)];
  if (!ids.length) return { plans: 0, sessions: 0, exercises: 0 };

  const { data: registry, error: registryError } = await admin
    .from('test_accounts')
    .select('user_id')
    .in('user_id', ids);
  if (registryError || registry.length !== ids.length) fail('synthetic registry changed before cleanup; no fixture data was touched');

  const { data: plans, error: plansError } = await admin
    .from('workout_plans')
    .select('id,user_id,name,description,plan_origin')
    .in('user_id', ids)
    .like('description', '[FLUX E2E fixture:%');
  if (plansError) fail(`could not inspect marked plans: ${plansError.message}`);

  const ownedPlans = (plans ?? []).filter((plan) => {
    const marker = typeof plan.description === 'string' ? plan.description : '';
    return markerPattern.test(marker) && plan.name.startsWith(`${marker} `);
  });
  const planIds = ownedPlans.map((plan) => plan.id);

  let sessions = [];
  if (planIds.length) {
    const { data, error } = await admin
      .from('workout_sessions')
      .select('id,user_id,plan_id,title')
      .in('plan_id', planIds)
      .in('user_id', ids);
    if (error) fail(`could not inspect marked sessions: ${error.message}`);
    const planById = new Map(ownedPlans.map((plan) => [plan.id, plan]));
    sessions = (data ?? []).filter((session) => {
      const plan = planById.get(session.plan_id);
      return Boolean(plan && plan.user_id === session.user_id && plan.name === session.title);
    });
    if (sessions.length !== (data ?? []).length) fail('a candidate session did not prove test ownership; no fixture data was touched');
  }

  const { data: exercises, error: exercisesError } = await admin
    .from('exercises')
    .select('id,user_id,name')
    .in('user_id', ids)
    .like('name', '%[FLUX E2E fixture:%');
  if (exercisesError) fail(`could not inspect marked exercises: ${exercisesError.message}`);
  const ownedExercises = (exercises ?? []).filter((exercise) => {
    const match = exercise.name.match(/(\[FLUX E2E fixture:[0-9a-f-]{36}\])$/i);
    return Boolean(match && markerPattern.test(match[1]));
  });

  if (sessions.length) {
    const sessionIds = sessions.map((session) => session.id);
    const { error } = await admin.from('workout_sessions').delete().in('id', sessionIds).in('user_id', ids);
    if (error) fail(`could not delete exact test-owned sessions: ${error.message}`);
    const [{ data: remainingSessions, error: remainingSessionsError }, { data: remainingSets, error: remainingSetsError }, { data: remainingCheckpoints, error: remainingCheckpointsError }] = await Promise.all([
      admin.from('workout_sessions').select('id').in('id', sessionIds).in('user_id', ids),
      admin.from('performed_sets').select('id').in('workout_session_id', sessionIds).in('user_id', ids),
      admin.from('workout_execution_checkpoints').select('workout_session_id').in('workout_session_id', sessionIds).in('user_id', ids),
    ]);
    if (remainingSessionsError || remainingSetsError || remainingCheckpointsError || (remainingSessions ?? []).length || (remainingSets ?? []).length || (remainingCheckpoints ?? []).length) {
      fail('exact session deletion left a session, performed set, or checkpoint; no plan cleanup was attempted');
    }
  }
  if (planIds.length) {
    for (const plan of ownedPlans) {
      // V3 materialised steps are intentionally guarded even from service-role
      // table deletes. Reuse the public, owner-authorised V3 delete contract
      // after exact marker + registry verification rather than bypassing it.
      if (plan.plan_origin !== 'personal') fail('a marked plan is not a personal-plan fixture; no fixture data was touched');
      const ownerClient = ownerClients?.get(plan.user_id);
      if (!ownerClient) fail('an exact verified fixture has no authenticated synthetic owner client');
      const { error } = await ownerClient.rpc('delete_my_workout_plan_v3', { p_plan_id: plan.id });
      if (error) fail(`could not delete exact test-owned plan through the V3 owner contract: ${error.message}`);
    }
    const { data: remainingPlans, error: remainingPlansError } = await admin.from('workout_plans').select('id').in('id', planIds).in('user_id', ids);
    if (remainingPlansError || (remainingPlans ?? []).length) fail('exact plan deletion left a marked plan; no exercise cleanup was attempted');
  }
  if (ownedExercises.length) {
    const { error } = await admin.from('exercises').delete().in('id', ownedExercises.map((exercise) => exercise.id)).in('user_id', ids);
    if (error) fail(`could not delete exact test-owned exercises: ${error.message}`);
    const { data: remainingExercises, error: remainingExercisesError } = await admin.from('exercises').select('id').in('id', ownedExercises.map((exercise) => exercise.id)).in('user_id', ids);
    if (remainingExercisesError || (remainingExercises ?? []).length) fail('exact exercise deletion left a marked exercise');
  }

  return { plans: planIds.length, sessions: sessions.length, exercises: ownedExercises.length };
}
