// Test-owned Workout fixtures use a per-run UUID marker in both the plan name
// and description. This is deliberately narrower than a persona-wide reset:
// every candidate is re-validated against the server-side synthetic registry
// before an exact-ID delete is issued.
const markerPattern = /^\[FLUX E2E fixture:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]$/i;

function fail(message) {
  throw new Error(`E2E fixture hygiene: ${message}`);
}

export async function cleanInterruptedWorkoutFixtures(admin, syntheticUserIds) {
  const ids = [...new Set(syntheticUserIds)];
  if (!ids.length) return { plans: 0, sessions: 0, exercises: 0 };

  const { data: registry, error: registryError } = await admin
    .from('test_accounts')
    .select('user_id')
    .in('user_id', ids);
  if (registryError || registry.length !== ids.length) fail('synthetic registry changed before cleanup; no fixture data was touched');

  const { data: plans, error: plansError } = await admin
    .from('workout_plans')
    .select('id,user_id,name,description')
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
  }
  if (planIds.length) {
    const { error } = await admin.from('workout_plans').delete().in('id', planIds).in('user_id', ids);
    if (error) fail(`could not delete exact test-owned plans: ${error.message}`);
  }
  if (ownedExercises.length) {
    const { error } = await admin.from('exercises').delete().in('id', ownedExercises.map((exercise) => exercise.id)).in('user_id', ids);
    if (error) fail(`could not delete exact test-owned exercises: ${error.message}`);
  }

  return { plans: planIds.length, sessions: sessions.length, exercises: ownedExercises.length };
}
