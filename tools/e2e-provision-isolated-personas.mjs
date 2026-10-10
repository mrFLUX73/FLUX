/*
 * One-time provisioning for the two isolated E2E clients. This intentionally
 * never resets existing personas or deletes data. A partially provisioned
 * account can be resumed only when its server-only app_metadata marker proves
 * that this tool created it.
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { E2E_ENV_PATH, loadE2eEnvironment } from './e2e-environment.mjs';
import { TEST_PERSONAS } from './e2e-contract.mjs';

const isolatedKeys = ['workout_e2e_client', 'nutrition_e2e_client'];
const requiredBaseKeys = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'TEST_TRAINER_LOGIN'];

function fail(message) { throw new Error(`ISOLATED E2E PROVISIONING: ${message}`); }
function assertError(error, context) { if (error) fail(`${context}: ${error.message}`); }

function writeCredentials(values) {
  const original = existsSync(E2E_ENV_PATH) ? readFileSync(E2E_ENV_PATH, 'utf8') : '';
  const managed = new Set(isolatedKeys.flatMap((key) => {
    const env = TEST_PERSONAS[key].env;
    return [`TEST_${env}_LOGIN`, `TEST_${env}_PASSWORD`];
  }));
  const preserved = original.split(/\r?\n/).filter((line) => ![...managed].some((name) => line.startsWith(`${name}=`)));
  const additions = isolatedKeys.flatMap((key) => {
    const env = TEST_PERSONAS[key].env;
    return [`TEST_${env}_LOGIN=${values[`TEST_${env}_LOGIN`]}`, `TEST_${env}_PASSWORD=${values[`TEST_${env}_PASSWORD`]}`];
  });
  writeFileSync(E2E_ENV_PATH, [...preserved, ...additions, ''].join('\n'), { mode: 0o600 });
  chmodSync(E2E_ENV_PATH, 0o600);
}

async function findUser(admin, email) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    assertError(error, 'Не удалось прочитать Auth users');
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
  fail('Не удалось закончить поиск Auth user');
}

async function registeredUser(admin, entry) {
  const user = await findUser(admin, `${entry.login}@flux.local`);
  if (!user) fail(`не найден обязательный synthetic user ${entry.env}`);
  const { data: registry, error } = await admin.from('test_accounts').select('user_id,purpose').eq('user_id', user.id).maybeSingle();
  assertError(error, `Не удалось проверить registry ${entry.env}`);
  if (!registry || registry.purpose !== entry.purpose) fail(`${entry.env} не зарегистрирован с ожидаемым purpose`);
  return user;
}

async function ensurePersona(admin, key, values) {
  const entry = TEST_PERSONAS[key];
  const loginKey = `TEST_${entry.env}_LOGIN`;
  const passwordKey = `TEST_${entry.env}_PASSWORD`;
  values[loginKey] ||= entry.login;
  values[passwordKey] ||= randomBytes(24).toString('base64url');
  writeCredentials(values);

  const email = `${values[loginKey]}@flux.local`;
  let user = await findUser(admin, email);
  if (user) {
    const { data: registry, error } = await admin.from('test_accounts').select('purpose').eq('user_id', user.id).maybeSingle();
    assertError(error, `Не удалось проверить existing registry ${entry.env}`);
    if (registry && registry.purpose !== entry.purpose) fail(`${entry.env} уже принадлежит другой registry purpose`);
    if (!registry && user.app_metadata?.flux_e2e_persona !== key) fail(`${entry.env} уже существует без доказанного isolated-E2E ownership`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: values[passwordKey],
      email_confirm: true,
      user_metadata: { display_name: entry.name, login: values[loginKey] },
      app_metadata: { flux_e2e_persona: key },
    });
    assertError(error, `Не удалось создать Auth user ${entry.env}`);
    user = data.user;
    if (!user) fail(`Auth не вернул созданного user ${entry.env}`);
  }

  const { error: profileError } = await admin.from('profiles').update({
    display_name: entry.name,
    login: values[loginKey],
    phone_e164: entry.phone,
    birth_date: '1992-04-17',
    biological_sex: 'male',
    height_cm: 181,
    current_weight_kg: 82.4,
    timezone: 'Europe/Samara',
    onboarding_completed: true,
  }).eq('id', user.id);
  assertError(profileError, `Не удалось настроить profile ${entry.env}`);
  assertError((await admin.from('user_roles').upsert({ user_id: user.id, role: 'user' }, { onConflict: 'user_id' })).error, `Не удалось назначить user role ${entry.env}`);
  assertError((await admin.from('test_accounts').upsert({ user_id: user.id, purpose: entry.purpose }, { onConflict: 'user_id' })).error, `Не удалось зарегистрировать ${entry.env}`);
  return user;
}

async function ensureNutritionBaseline(admin, userId) {
  assertError((await admin.from('nutrition_goals').upsert({ user_id: userId, goal_type: 'maintain', activity_level: 'moderate', daily_calories: 2200, protein_g: 150, carbohydrates_g: 235, fat_g: 70, fiber_g: 30, water_ml: 2200, target_weight_kg: 80 }, { onConflict: 'user_id' })).error, 'Не удалось настроить Nutrition goals');
  assertError((await admin.from('nutrition_settings').upsert({ user_id: userId, meals_per_day: 4, show_macronutrients: true, track_water: true }, { onConflict: 'user_id' })).error, 'Не удалось настроить Nutrition settings');
}

async function ensureTrainerLink(admin, trainerId, clientId) {
  const { data: links, error } = await admin.from('trainer_client_links').select('id,trainer_id,status').eq('client_id', clientId);
  assertError(error, 'Не удалось проверить Nutrition E2E trainer link');
  if ((links ?? []).some((link) => link.trainer_id !== trainerId && link.status === 'active')) fail('Nutrition E2E client уже связан с другим активным trainer');
  if ((links ?? []).some((link) => link.trainer_id === trainerId && link.status === 'active')) return;
  assertError((await admin.from('trainer_client_links').insert({ trainer_id: trainerId, client_id: clientId, status: 'active', responded_at: new Date().toISOString() })).error, 'Не удалось создать Nutrition E2E trainer link');
}

async function main() {
  const { values, missingFile } = loadE2eEnvironment();
  if (missingFile || requiredBaseKeys.some((key) => !values[key])) fail('неполный .env.e2e.local; provisioning остановлен до изменений');
  const admin = createClient(values.VITE_SUPABASE_URL, values.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const trainer = await registeredUser(admin, TEST_PERSONAS.trainer);
  const workout = await ensurePersona(admin, 'workout_e2e_client', values);
  const nutrition = await ensurePersona(admin, 'nutrition_e2e_client', values);
  await ensureNutritionBaseline(admin, nutrition.id);
  await ensureTrainerLink(admin, trainer.id, nutrition.id);

  for (const [key, user] of [['workout_e2e_client', workout], ['nutrition_e2e_client', nutrition]]) {
    const entry = TEST_PERSONAS[key];
    const { data: registry, error } = await admin.from('test_accounts').select('user_id,purpose').eq('user_id', user.id).maybeSingle();
    assertError(error, `Не удалось проверить итоговый registry ${entry.env}`);
    if (!registry || registry.purpose !== entry.purpose) fail(`итоговая registry verification failed for ${entry.env}`);
  }
  console.log(`Provisioned isolated synthetic personas: ${workout.id}, ${nutrition.id}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
