import { createClient } from '@supabase/supabase-js';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

type Persona = 'TRAINER' | 'CLIENT' | 'EMPTY_CLIENT' | 'OTHER_TRAINER' | 'WORKOUT_E2E_CLIENT' | 'NUTRITION_E2E_CLIENT';

type WorkoutStepInput = {
  exerciseId: string;
  targetSets: number;
  targetRepsMin: number | null;
  targetDurationSeconds: number | null;
  targetDistanceM: number | null;
  targetWeightKg: number | null;
  restSeconds: number;
};

type WorkoutV3PlannedSetInput = {
  targetRepsMin?: number | null;
  targetRepsMax?: number | null;
  targetDurationSeconds?: number | null;
  targetDistanceM?: number | null;
  targetWeightKg?: number | null;
  restSeconds?: number | null;
};

type WorkoutV3StepInput = {
  exerciseId: string;
  plannedSets: WorkoutV3PlannedSetInput[];
};

type OwnedPlan = { id: string; name: string };
type NutritionFixtureProduct = { id: string; name: string; amount: number; kcal: number; protein: number; carbs: number; fat: number };

const workoutFixtureMarker = (token: string) => `[FLUX E2E fixture:${token}]`;
const nutritionFixtureMarker = (token: string) => `[FLUX E2E nutrition:${token}]`;

// The browser uses normal authenticated RPCs to create the fixture. Cleanup is
// Node-only because the product deliberately exposes no "delete session"
// endpoint. Every delete is constrained by the UUIDs returned in this test,
// the marker stored in the record, and the server-side test_accounts registry.
export function createWorkoutFixtureScope(page: Page, userId: string, label: string, ownerPersona: Persona = 'WORKOUT_E2E_CLIENT') {
  const marker = workoutFixtureMarker(randomUUID());
  const planName = `${marker} ${label}`;
  const exerciseIds = new Map<string, string>();
  const plans = new Map<string, OwnedPlan>();
  const sessions = new Set<string>();

  const registerPlan = (plan: { id: string; name?: string }) => {
    if (!plan.id) throw new Error('E2E fixture did not return a plan id');
    plans.set(plan.id, { id: plan.id, name: plan.name ?? planName });
    return plan.id;
  };

  const registerExercise = (exercise: { id: string; name: string }) => {
    if (!exercise.id || !exercise.name.endsWith(` ${marker}`)) {
      throw new Error('E2E fixture did not return an owned exercise.');
    }
    exerciseIds.set(exercise.id, exercise.name);
    return exercise.id;
  };

  const registerSession = (session: { id: string; title?: string; plan_id?: string | null }) => {
    if (!session.id || session.title !== planName || !session.plan_id || !plans.has(session.plan_id)) {
      throw new Error('FIXTURE STATE BLOCKER: an active workout is not owned by this E2E fixture. No foreign session was changed.');
    }
    sessions.add(session.id);
    return session.id;
  };

  return {
    marker,
    planName,
    description: marker,
    exerciseName: (name: string) => `${name} ${marker}`,
    registerPlan,
    registerExercise,
    forgetPlan: (planId: string) => { plans.delete(planId); },
    registerSession,
    async assertNoActiveWorkout() {
      const result = await storedSessionRpc(page, 'get_my_active_workout_session', {});
      if (result.status !== 200) throw new Error(`E2E fixture precondition check failed (${result.status})`);
      if (result.data) throw new Error('FIXTURE STATE BLOCKER: synthetic persona already has a non-test-owned active workout. No record was changed.');
    },
    async createExercise(name: string, measurementType: 'reps' | 'duration' | 'distance', instructions: string | null = null) {
      const ownedName = `${name} ${marker}`;
      const result = await storedSessionRpc(page, 'create_my_exercise', {
        p_name: ownedName,
        p_measurement_type: measurementType,
        p_instructions: instructions,
        p_category: null,
      });
      if (result.status !== 200 || !result.data || typeof result.data !== 'object' || !('id' in result.data)) throw new Error(`E2E fixture exercise creation failed (${result.status})`);
      const id = (result.data as { id: string }).id;
      exerciseIds.set(id, ownedName);
      return { id, name: ownedName };
    },
    async savePlan(steps: WorkoutStepInput[]) {
      const result = await storedSessionRpc(page, 'save_my_workout_plan', {
        p_plan_id: null,
        p_name: planName,
        p_description: marker,
        p_level: 'beginner',
        p_estimated_duration_minutes: 20,
        p_steps: steps.map((step) => ({
          exercise_id: step.exerciseId,
          target_sets: step.targetSets,
          target_reps_min: step.targetRepsMin,
          target_reps_max: null,
          target_duration_seconds: step.targetDurationSeconds,
          target_distance_m: step.targetDistanceM,
          target_weight_kg: step.targetWeightKg,
          rest_seconds: step.restSeconds,
          notes: null,
        })),
      });
      if (result.status !== 200 || !result.data || typeof result.data !== 'object' || !('id' in result.data)) throw new Error(`E2E fixture plan creation failed (${result.status})`);
      const plan = result.data as { id: string; name?: string };
      registerPlan(plan);
      return plan;
    },
    async savePlanV3(steps: WorkoutV3StepInput[]) {
      const result = await storedSessionRpc(page, 'save_my_workout_plan_v3', {
        p_plan_id: null,
        p_name: planName,
        p_description: marker,
        p_level: 'beginner',
        p_estimated_duration_minutes: 20,
        p_steps: steps.map((step) => ({
          step_id: null,
          exercise_source_kind: 'personal',
          exercise_source_id: step.exerciseId,
          day_number: 1,
          notes: null,
          planned_sets: step.plannedSets.map((plannedSet) => ({
            set_id: null,
            target_reps_min: plannedSet.targetRepsMin ?? null,
            target_reps_max: plannedSet.targetRepsMax ?? null,
            target_duration_seconds: plannedSet.targetDurationSeconds ?? null,
            target_distance_m: plannedSet.targetDistanceM ?? null,
            target_weight_kg: plannedSet.targetWeightKg ?? null,
            rest_seconds: plannedSet.restSeconds ?? null,
          })),
        })),
      });
      if (result.status !== 200 || !result.data || typeof result.data !== 'object' || !('id' in result.data)) throw new Error(`E2E V3 fixture plan creation failed (${result.status})`);
      const plan = result.data as { id: string; name?: string };
      registerPlan(plan);
      return plan;
    },
    async startPlan(planId: string) {
      const result = await storedSessionRpc(page, 'start_personal_workout', { p_plan_id: planId });
      if (result.status !== 200 || !result.data || typeof result.data !== 'object' || !('id' in result.data)) throw new Error(`E2E fixture session start failed (${result.status})`);
      const session = result.data as { id: string; title?: string; plan_id?: string | null };
      registerSession(session);
      return session;
    },
    async startPlanV3(planId: string) {
      const result = await storedSessionRpc(page, 'start_personal_workout_v3', { p_plan_id: planId });
      if (result.status !== 200 || !result.data || typeof result.data !== 'object' || !('id' in result.data)) throw new Error(`E2E V3 fixture session start failed (${result.status})`);
      const session = result.data as { id: string; title?: string; plan_id?: string | null };
      registerSession(session);
      return session;
    },
    async cleanup() {
      if (!plans.size && !exerciseIds.size && !sessions.size) return;
      const admin = createClient(environment('VITE_SUPABASE_URL'), environment('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: registry, error: registryError } = await admin.from('test_accounts').select('user_id').eq('user_id', userId).maybeSingle();
      if (registryError || !registry) throw new Error('E2E fixture cleanup refused: owner is not registered as synthetic.');

      const planIds = [...plans.keys()];
      if (planIds.length) {
        const { data, error } = await admin.from('workout_plans').select('id,user_id,description,plan_origin').in('id', planIds).eq('user_id', userId);
        if (error || (data ?? []).some((plan) => plan.description !== marker || plan.plan_origin !== 'personal') || (data ?? []).length !== planIds.length) throw new Error('E2E fixture cleanup refused: plan ownership marker does not match.');
      }
      const sessionIds = [...sessions];
      if (sessionIds.length) {
        const { data, error } = await admin.from('workout_sessions').select('id,user_id,plan_id,title').in('id', sessionIds).eq('user_id', userId);
        if (error || (data ?? []).length !== sessionIds.length || (data ?? []).some((session) => session.title !== planName || !session.plan_id || !plans.has(session.plan_id))) {
          throw new Error('E2E fixture cleanup refused: session ownership marker does not match.');
        }
        const { error: deleteSessionsError } = await admin.from('workout_sessions').delete().in('id', sessionIds).eq('user_id', userId);
        if (deleteSessionsError) throw new Error(`E2E fixture session cleanup failed: ${deleteSessionsError.message}`);

        // Do not call the guarded V3 plan deletion until the exact active
        // sessions and their server-owned dependents are observably gone.
        // This makes cleanup fail closed instead of racing a still-live browser
        // session against the owner-facing V3 delete RPC.
        const [{ data: remainingSessions, error: remainingSessionsError }, { data: remainingSets, error: remainingSetsError }, { data: remainingCheckpoints, error: remainingCheckpointsError }] = await Promise.all([
          admin.from('workout_sessions').select('id').in('id', sessionIds).eq('user_id', userId),
          admin.from('performed_sets').select('id').in('workout_session_id', sessionIds).eq('user_id', userId),
          admin.from('workout_execution_checkpoints').select('workout_session_id').in('workout_session_id', sessionIds).eq('user_id', userId),
        ]);
        if (remainingSessionsError || remainingSetsError || remainingCheckpointsError || (remainingSessions ?? []).length || (remainingSets ?? []).length || (remainingCheckpoints ?? []).length) {
          throw new Error('E2E fixture session cleanup did not remove every exact session dependency.');
        }
      }
      if (planIds.length) {
        // Use the owner-facing V3 delete RPC. Its server-issued capability is
        // the only valid way to cascade through materialised V3 plan steps.
        const ownerClient = await ownerFixtureRpcClient(ownerPersona, userId);
        for (const planId of planIds) {
          const { error } = await ownerClient.rpc('delete_my_workout_plan_v3', { p_plan_id: planId });
          if (error) throw new Error(`E2E fixture V3 plan cleanup failed: ${error.message}`);
        }
        const { data: remainingPlans, error: remainingPlansError } = await admin.from('workout_plans').select('id').in('id', planIds).eq('user_id', userId);
        if (remainingPlansError || (remainingPlans ?? []).length) throw new Error('E2E fixture V3 plan cleanup did not remove every exact plan.');
      }
      const ownedExerciseIds = [...exerciseIds.keys()];
      if (ownedExerciseIds.length) {
        const { data, error } = await admin.from('exercises').select('id,user_id,name').in('id', ownedExerciseIds).eq('user_id', userId);
        if (error || (data ?? []).length !== ownedExerciseIds.length || (data ?? []).some((exercise) => exercise.name !== exerciseIds.get(exercise.id))) {
          throw new Error('E2E fixture cleanup refused: exercise ownership marker does not match.');
        }
        const { error: deleteExercisesError } = await admin.from('exercises').delete().in('id', ownedExerciseIds).eq('user_id', userId);
        if (deleteExercisesError) throw new Error(`E2E fixture exercise cleanup failed: ${deleteExercisesError.message}`);
        const { data: remainingExercises, error: remainingExercisesError } = await admin.from('exercises').select('id').in('id', ownedExerciseIds).eq('user_id', userId);
        if (remainingExercisesError || (remainingExercises ?? []).length) throw new Error('E2E fixture exercise cleanup did not remove every exact exercise.');
      }
      sessions.clear();
      plans.clear();
      exerciseIds.clear();
    },
  };
}

// Nutrition fixtures use an owned catalog product whose UUID marker is copied
// into every item created through the normal UI. That gives both the test and
// interrupted-run hygiene an auditable ownership boundary without touching a
// shared product or a pre-seeded diary row.
export function createNutritionFixtureScope(userId: string, label: string) {
  const marker = nutritionFixtureMarker(randomUUID());
  const products = new Map<string, NutritionFixtureProduct>();

  const admin = () => createClient(environment('VITE_SUPABASE_URL'), environment('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  const verifySyntheticOwner = async () => {
    const { data, error } = await admin().from('test_accounts').select('user_id').eq('user_id', userId).maybeSingle();
    if (error || !data) throw new Error('E2E nutrition fixture refused: owner is not registered as synthetic.');
  };

  return {
    marker,
    productName: (name: string) => `${name} ${marker}`,
    async createProduct(name: string, values: { amount?: number; kcal?: number; protein?: number; carbs?: number; fat?: number } = {}) {
      await verifySyntheticOwner();
      const product: NutritionFixtureProduct = {
        id: randomUUID(), name: `${name} ${marker}`,
        amount: values.amount ?? 100, kcal: values.kcal ?? 100, protein: values.protein ?? 10, carbs: values.carbs ?? 10, fat: values.fat ?? 5,
      };
      const { error } = await admin().from('products').insert({
        id: product.id, owner_id: userId, name: product.name, brand: 'FLUX E2E', category: 'E2E',
        serving_size_g: product.amount, serving_unit: 'g', default_serving_quantity: product.amount,
        energy_kcal_per_100g: product.kcal, protein_g_per_100g: product.protein,
        carbohydrates_g_per_100g: product.carbs, fat_g_per_100g: product.fat, fiber_g_per_100g: 0,
      });
      if (error) throw new Error(`E2E nutrition fixture product creation failed: ${error.message}`);
      products.set(product.id, product);
      return product;
    },
    async seedEntry(product: NutritionFixtureProduct, input: { meal: 'breakfast' | 'lunch' | 'dinner' | 'snack'; eatenAt: string; quantity: number }) {
      if (!products.has(product.id)) throw new Error('E2E nutrition fixture refused: product is not owned by this scope.');
      await verifySyntheticOwner();
      const mealId = randomUUID(); const itemId = randomUUID(); const factor = input.quantity / product.amount;
      const instance = admin();
      const { error: mealError } = await instance.from('meals').insert({ id: mealId, user_id: userId, meal_type: input.meal, eaten_at: input.eatenAt, note: marker });
      if (mealError) throw new Error(`E2E nutrition fixture meal creation failed: ${mealError.message}`);
      const { error: itemError } = await instance.from('meal_items').insert({
        id: itemId, meal_id: mealId, user_id: userId, product_id: product.id, product_name: product.name,
        portion_quantity: input.quantity, portion_unit: 'g', amount_g: input.quantity,
        energy_kcal: product.kcal * factor, protein_g: product.protein * factor,
        carbohydrates_g: product.carbs * factor, fat_g: product.fat * factor, fiber_g: 0,
      });
      if (itemError) throw new Error(`E2E nutrition fixture item creation failed: ${itemError.message}`);
      return { mealId, itemId };
    },
    async cleanup() {
      await verifySyntheticOwner();
      const instance = admin(); const productIds = [...products.keys()];
      if (!productIds.length) return;
      const { data: verifiedProducts, error: productError } = await instance.from('products').select('id,owner_id,name').in('id', productIds).eq('owner_id', userId);
      if (productError || (verifiedProducts ?? []).length !== productIds.length || (verifiedProducts ?? []).some((product) => product.name !== products.get(product.id)?.name || !product.name.endsWith(` ${marker}`))) throw new Error('E2E nutrition fixture cleanup refused: product ownership marker does not match.');
      const { data: productItems, error: itemError } = await instance.from('meal_items').select('id,user_id,meal_id,product_id,product_name').in('product_id', productIds).eq('user_id', userId);
      const { data: externalItems, error: externalItemError } = await instance.from('meal_items').select('id,user_id,meal_id,product_id,product_name,external_source').eq('user_id', userId).is('product_id', null).like('product_name', `% ${marker}`);
      if (itemError || externalItemError || (productItems ?? []).some((item) => item.product_name !== products.get(item.product_id)?.name) || (externalItems ?? []).some((item) => item.external_source !== 'nutriapix' || !item.product_name.endsWith(` ${marker}`))) throw new Error('E2E nutrition fixture cleanup refused: item ownership marker does not match.');
      const items = [...(productItems ?? []), ...(externalItems ?? [])];
      const itemIds = items.map((item) => item.id); const mealIds = [...new Set(items.map((item) => item.meal_id))];
      if (mealIds.length) {
        const { data: allMealItems, error: allMealItemsError } = await instance.from('meal_items').select('id,user_id,meal_id,product_id').in('meal_id', mealIds).eq('user_id', userId);
        if (allMealItemsError || (allMealItems ?? []).length !== itemIds.length || (allMealItems ?? []).some((item) => !itemIds.includes(item.id) || (item.product_id !== null && !productIds.includes(item.product_id)))) throw new Error('E2E nutrition fixture cleanup refused: a meal contains a non-owned item.');
      }
      if (itemIds.length) {
        const { error } = await instance.from('meal_items').delete().in('id', itemIds).eq('user_id', userId);
        if (error) throw new Error(`E2E nutrition fixture item cleanup failed: ${error.message}`);
      }
      if (mealIds.length) {
        const { error } = await instance.from('meals').delete().in('id', mealIds).eq('user_id', userId);
        if (error) throw new Error(`E2E nutrition fixture meal cleanup failed: ${error.message}`);
      }
      const { data: remainingItems, error: remainingItemsError } = await instance.from('meal_items').select('id').in('product_id', productIds).eq('user_id', userId);
      if (remainingItemsError || (remainingItems ?? []).length) throw new Error('E2E nutrition fixture cleanup refused: owned product still has meal items.');
      const { error: deleteProductsError } = await instance.from('products').delete().in('id', productIds).eq('owner_id', userId);
      if (deleteProductsError) throw new Error(`E2E nutrition fixture product cleanup failed: ${deleteProductsError.message}`);
    },
  };
}

function environment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`E2E environment variable ${name} is required`);
  return value;
}

export async function cleanupOwnedSyntheticWorkoutSession(userId: string, sessionId: string, expectedTitle: string) {
  const admin = createClient(environment('VITE_SUPABASE_URL'), environment('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: registry, error: registryError } = await admin.from('test_accounts').select('user_id').eq('user_id', userId).maybeSingle();
  if (registryError || !registry) throw new Error('E2E session cleanup refused: owner is not registered as synthetic.');
  const { data: session, error: sessionError } = await admin.from('workout_sessions').select('id,user_id,title').eq('id', sessionId).eq('user_id', userId).maybeSingle();
  if (sessionError || !session || session.title !== expectedTitle) throw new Error('E2E session cleanup refused: exact ownership marker does not match.');
  const { error: deleteError } = await admin.from('workout_sessions').delete().eq('id', sessionId).eq('user_id', userId);
  if (deleteError) throw new Error(`E2E session cleanup failed: ${deleteError.message}`);
}

export function credentials(persona: Persona) {
  return { login: environment(`TEST_${persona}_LOGIN`), password: environment(`TEST_${persona}_PASSWORD`) };
}

// Production has Turnstile enabled, so a headless local preview cannot use the
// public password form without weakening CAPTCHA. A one-time magic link is
// generated server-side only for a registry-owned synthetic account, then
// verified with the publishable client to create the same browser session.
// No service-role value reaches Vite, the page, or a screenshot.
export async function fixtureSession(persona: Persona) {
  const { login, password } = credentials(persona);
  const url = environment('VITE_SUPABASE_URL');
  const key = environment('VITE_SUPABASE_PUBLISHABLE_KEY');
  const serviceRole = environment('SUPABASE_SERVICE_ROLE_KEY');
  // Read the password as a required fixture credential: this prevents a stale
  // local config from silently authenticating a different account.
  if (!password) throw new Error(`Missing local fixture password for ${persona}`);
  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: `${login}@flux.local` });
  if (linkError || !link.properties.hashed_token) throw new Error(`Fixture session link failed for ${persona}: ${linkError?.message ?? 'missing token'}`);
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token });
  if (error || !data.session) throw new Error(`Fixture session verification failed for ${persona}: ${error?.message ?? 'missing session'}`);
  return data.session;
}

// The UI page can still be settling while its fixture is being cleaned up.
// Use a separate Node-only authenticated client for the protected V3 plan
// deletion, exactly as interrupted-fixture hygiene does. The client is pinned
// to a named synthetic persona and its server-returned identity must match the
// scope owner before any RPC can run.
const cleanupOwnerSessions = new Map<Persona, Promise<Awaited<ReturnType<typeof fixtureSession>>>>();

async function ownerFixtureRpcClient(persona: Persona, expectedUserId: string) {
  let sessionPromise = cleanupOwnerSessions.get(persona);
  if (!sessionPromise) {
    sessionPromise = fixtureSession(persona);
    cleanupOwnerSessions.set(persona, sessionPromise);
  }
  let session;
  try {
    session = await sessionPromise;
  } catch (error) {
    cleanupOwnerSessions.delete(persona);
    throw error;
  }
  if (session.user.id !== expectedUserId) throw new Error('E2E fixture cleanup refused: synthetic owner session identity does not match.');

  const client = createClient(environment('VITE_SUPABASE_URL'), environment('VITE_SUPABASE_PUBLISHABLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  if (error) throw new Error(`E2E fixture cleanup owner session setup failed: ${error.message}`);
  return client;
}

const authBootstrapPath = '/__flux_e2e_auth_bootstrap__.html';
const localSupabaseScriptPath = '/__flux_e2e_supabase__.js';

// These routes exist only inside the Playwright browser context. The SDK is
// read from the already-installed local dependency rather than a CDN, so no
// test token is ever given to a third party. Supabase itself persists the
// session for the preview origin through its documented browser API.
const authBootstrapDocument = `<!doctype html><html><body>
  <script src="${localSupabaseScriptPath}"></script>
  <script>
    window.__fluxSetTestSession = async function (input) {
      const client = window.supabase.createClient(input.url, input.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      });
      const result = await client.auth.setSession({ access_token: input.accessToken, refresh_token: input.refreshToken });
      if (result.error) return { error: result.error.message };
      const user = await client.auth.getUser();
      if (user.error || !user.data.user) return { error: user.error ? user.error.message : 'User was not restored' };
      return { userId: user.data.user.id, sessionUserId: result.data.session ? result.data.session.user.id : null };
    };
  </script>
</body></html>`;

export function statePath(persona: Persona) {
  const file = { CLIENT: 'client', TRAINER: 'trainer', EMPTY_CLIENT: 'empty-client', OTHER_TRAINER: 'other-trainer', WORKOUT_E2E_CLIENT: 'workout-e2e-client', NUTRITION_E2E_CLIENT: 'nutrition-e2e-client' }[persona];
  return path.join('.e2e', 'auth', `${file}.json`);
}

export async function authenticatedContext(browser: Browser, persona: Persona, width = 390, options: { mobile?: boolean } = {}): Promise<{ context: BrowserContext; page: Page; userId: string }> {
  const session = await fixtureSession(persona);
  const context = await browser.newContext({ viewport: { width, height: 844 }, ...(options.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await context.newPage();
  const localSdk = await readFile(path.join(process.cwd(), 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'), 'utf8');
  await page.route(`**${localSupabaseScriptPath}`, (route) => route.fulfill({ contentType: 'application/javascript', body: localSdk }));
  await page.route(`**${authBootstrapPath}`, (route) => route.fulfill({ contentType: 'text/html', body: authBootstrapDocument }));
  const baseUrl = process.env.FLUX_E2E_BASE_URL ?? 'http://127.0.0.1:4179';
  await page.goto(`${baseUrl}${authBootstrapPath}`);
  await expect.poll(() => page.evaluate(() => typeof (window as typeof window & { __fluxSetTestSession?: unknown }).__fluxSetTestSession === 'function')).toBe(true);
  const result = await page.evaluate(async ({ url, key, accessToken, refreshToken }) => {
    const setSession = (window as typeof window & { __fluxSetTestSession: (input: { url: string; key: string; accessToken: string; refreshToken: string }) => Promise<{ userId?: string; sessionUserId?: string; error?: string }> }).__fluxSetTestSession;
    return setSession({ url, key, accessToken, refreshToken });
  }, { url: environment('VITE_SUPABASE_URL'), key: environment('VITE_SUPABASE_PUBLISHABLE_KEY'), accessToken: session.access_token, refreshToken: session.refresh_token });
  if (result.error || !result.userId || result.userId !== session.user.id || result.sessionUserId !== session.user.id) {
    await context.close();
    throw new Error(`Official browser session setup failed for ${persona}: ${result.error ?? 'unexpected user identity'}`);
  }
  await page.goto(baseUrl);
  return { context, page, userId: result.userId };
}

export async function signedInPage(browser: Browser, persona: Persona, width = 390): Promise<{ context: BrowserContext; page: Page }> {
  const { context, page } = await authenticatedContext(browser, persona, width);
  return { context, page };
}

export function collectRuntime(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`));
  return () => errors;
}

export async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const outOfBounds = await page.locator('button, input, textarea, select, a').evaluateAll((nodes) => nodes
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1);
    }).map((node) => (node as HTMLElement).innerText || node.getAttribute('aria-label') || node.tagName));
  expect(outOfBounds, `Interactive elements outside viewport: ${outOfBounds.join(', ')}`).toEqual([]);
}

export async function openApp(page: Page) {
  await expect(page.getByLabel('Приложение FLUX')).toBeVisible();
}

export async function settleUi(page: Page) {
  await page.waitForFunction(() => [...document.querySelectorAll('.flux-content, .flux-content > *')]
    .every((element) => element.getAnimations().every((animation) => animation.playState !== 'running'))).catch(() => undefined);
  await page.waitForTimeout(250);
}

export async function stableScreenshot(page: Page, path: string) {
  await settleUi(page);
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
}

export async function storedSessionRpcStatus(page: Page, fn: string, body: Record<string, unknown>) {
  const localSdk = await readFile(path.join(process.cwd(), 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'), 'utf8');
  await page.addScriptTag({ content: localSdk });
  return page.evaluate(async ({ url, key, fn, body }) => {
    const client = (window as typeof window & { supabase: { createClient: typeof createClient } }).supabase.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData.session) return { status: 0, authenticated: false };
    const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${sessionData.session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, authenticated: true, userId: sessionData.session.user.id };
  }, { url: environment('VITE_SUPABASE_URL'), key: environment('VITE_SUPABASE_PUBLISHABLE_KEY'), fn, body });
}

export async function storedSessionRpc(page: Page, fn: string, body: Record<string, unknown>) {
  const localSdk = await readFile(path.join(process.cwd(), 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'), 'utf8');
  await page.addScriptTag({ content: localSdk });
  return page.evaluate(async ({ url, key, fn, body }) => {
    const client = (window as typeof window & { supabase: { createClient: typeof createClient } }).supabase.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData.session) return { status: 0, authenticated: false, data: null };
    const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${sessionData.session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, authenticated: true, data };
  }, { url: environment('VITE_SUPABASE_URL'), key: environment('VITE_SUPABASE_PUBLISHABLE_KEY'), fn, body });
}
