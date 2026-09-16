/*
 * Local-only FLUX test fixtures. It uses the service role solely in Node and
 * refuses to mutate an existing account unless it is already in test_accounts.
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve('.env.e2e.local');
const purposes = ['trainer', 'client', 'empty_client', 'other_trainer'];
const defaults = {
  trainer: { login: 'flux-test-trainer', name: 'Артём Ветров', phone: '+79990000011', code: 'TR-TSTTRN01' },
  client: { login: 'flux-test-client', name: 'Илья Северин', phone: '+79990000012' },
  empty_client: { login: 'flux-empty-client', name: 'Пустой Тест', phone: '+79990000013' },
  other_trainer: { login: 'flux-other-trainer', name: 'Олег Каменный', phone: '+79990000014', code: 'TR-OTHTRN01' },
};

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    return match ? [[match[1], match[2]]] : [];
  }));
}

function writeEnv(values) {
  const lines = [
    '# Local-only FLUX E2E credentials. This file is gitignored.',
    '# Do not copy these values into source code, browser bundles, or chat.',
    `VITE_SUPABASE_URL=${values.VITE_SUPABASE_URL ?? ''}`,
    `VITE_SUPABASE_PUBLISHABLE_KEY=${values.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''}`,
    `SUPABASE_SERVICE_ROLE_KEY=${values.SUPABASE_SERVICE_ROLE_KEY ?? ''}`,
    ...purposes.flatMap((purpose) => {
      const prefix = `TEST_${purpose.toUpperCase()}_`;
      return [`${prefix}LOGIN=${values[`${prefix}LOGIN`]}`, `${prefix}PASSWORD=${values[`${prefix}PASSWORD`]}`];
    }),
    '',
  ];
  writeFileSync(envPath, lines.join('\n'), { mode: 0o600 });
  chmodSync(envPath, 0o600);
}

function preparedEnvironment() {
  const values = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {};
  for (const purpose of purposes) {
    const prefix = `TEST_${purpose.toUpperCase()}_`;
    values[`${prefix}LOGIN`] ||= defaults[purpose].login;
    values[`${prefix}PASSWORD`] ||= randomBytes(24).toString('base64url');
  }
  writeEnv(values);
  return values;
}

function fail(message) { throw new Error(`TEST FIXTURES: ${message}`); }
function assertError(error, context) { if (error) fail(`${context}: ${error.message}`); }
function isoAt(daysAgo, hour) { const date = new Date(); date.setDate(date.getDate() - daysAgo); date.setHours(hour, 0, 0, 0); return date.toISOString(); }

async function findAuthUser(admin, email) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    assertError(error, 'Не удалось прочитать Auth-пользователей');
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 1000) break;
  }
  return null;
}

async function createOrVerifyAccounts(admin, values) {
  const known = new Map();
  for (const purpose of purposes) {
    const prefix = `TEST_${purpose.toUpperCase()}_`;
    const login = values[`${prefix}LOGIN`];
    const password = values[`${prefix}PASSWORD`];
    if (!login || !password) fail(`Не настроены credentials для ${purpose}`);
    const email = `${login}@flux.local`;
    let user = await findAuthUser(admin, email);
    if (user) {
      const { data: registry, error } = await admin.from('test_accounts').select('purpose').eq('user_id', user.id).maybeSingle();
      assertError(error, 'Не удалось проверить test_accounts');
      if (!registry || registry.purpose !== purpose) {
        fail(`существующий ${email} отсутствует в test_accounts с ожидаемым purpose; остановлено без изменений`);
      }
      const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true, user_metadata: { display_name: defaults[purpose].name, login } });
      assertError(updateError, `Не удалось обновить test Auth-пользователя ${purpose}`);
    } else {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: defaults[purpose].name, login } });
      assertError(error, `Не удалось создать test Auth-пользователя ${purpose}`);
      user = data.user;
      if (!user) fail(`Supabase не вернул созданного пользователя ${purpose}`);
    }
    const { error: registryError } = await admin.from('test_accounts').upsert({ user_id: user.id, purpose }, { onConflict: 'user_id' });
    assertError(registryError, `Не удалось зарегистрировать ${purpose} как test account`);
    known.set(purpose, user.id);
  }
  return known;
}

async function expectRegistry(admin, ids) {
  const values = [...ids.values()];
  const { data, error } = await admin.from('test_accounts').select('user_id,purpose').in('user_id', values);
  assertError(error, 'Не удалось подтвердить test registry');
  if (data.length !== purposes.length || purposes.some((purpose) => !data.some((row) => row.user_id === ids.get(purpose) && row.purpose === purpose))) {
    fail('registry не совпадает с ожидаемыми test personas; destructive reset не выполнялся');
  }
}

async function removeBaselineData(admin, ids) {
  const all = [...ids.values()]; const clientId = ids.get('client');
  // Only rows whose two participants are test accounts are ever touched.
  const { data: links, error: linksError } = await admin.from('trainer_client_links').select('id').in('trainer_id', all).in('client_id', all);
  assertError(linksError, 'Не удалось прочитать test trainer links');
  const linkIds = links.map((link) => link.id);
  if (linkIds.length) {
    assertError((await admin.from('trainer_messages').delete().in('link_id', linkIds)).error, 'Не удалось очистить test messages');
    assertError((await admin.from('trainer_client_notes').delete().in('trainer_id', all).in('client_id', all)).error, 'Не удалось очистить test notes');
    assertError((await admin.from('trainer_client_links').delete().in('id', linkIds).in('trainer_id', all).in('client_id', all)).error, 'Не удалось очистить test links');
  }
  for (const table of ['performed_sets', 'workout_plan_exercises', 'workout_sessions', 'workout_plans', 'exercises', 'meal_items', 'meals']) {
    assertError((await admin.from(table).delete().eq('user_id', clientId)).error, `Не удалось очистить ${table}`);
  }
  assertError((await admin.from('products').delete().eq('owner_id', clientId)).error, 'Не удалось очистить products');
  assertError((await admin.from('nutrition_goals').delete().eq('user_id', clientId)).error, 'Не удалось очистить nutrition_goals');
  assertError((await admin.from('nutrition_settings').delete().eq('user_id', clientId)).error, 'Не удалось очистить nutrition_settings');
}

async function seedProfiles(admin, ids) {
  for (const purpose of purposes) {
    const id = ids.get(purpose); const entry = defaults[purpose]; const isClient = purpose === 'client';
    const patch = isClient ? { display_name: entry.name, login: entry.login, phone_e164: entry.phone, birth_date: '1992-04-17', biological_sex: 'male', height_cm: 181, current_weight_kg: 82.4, timezone: 'Europe/Samara', onboarding_completed: true } : { display_name: entry.name, login: entry.login, phone_e164: entry.phone, birth_date: null, biological_sex: null, height_cm: null, current_weight_kg: null, timezone: 'Europe/Samara', onboarding_completed: false };
    assertError((await admin.from('profiles').update(patch).eq('id', id)).error, `Не удалось заполнить профиль ${purpose}`);
    assertError((await admin.from('user_roles').upsert({ user_id: id, role: purpose === 'trainer' || purpose === 'other_trainer' ? 'trainer' : 'user' }, { onConflict: 'user_id' })).error, `Не удалось назначить роль ${purpose}`);
  }
  for (const purpose of ['trainer', 'other_trainer']) {
    assertError((await admin.from('trainer_profiles').upsert({ user_id: ids.get(purpose), invite_code: defaults[purpose].code }, { onConflict: 'user_id' })).error, `Не удалось настроить trainer profile ${purpose}`);
  }
}

async function seedNutrition(admin, clientId) {
  assertError((await admin.from('nutrition_goals').upsert({ user_id: clientId, goal_type: 'maintain', activity_level: 'moderate', daily_calories: 2200, protein_g: 150, carbohydrates_g: 235, fat_g: 70, fiber_g: 30, water_ml: 2200, target_weight_kg: 80 }, { onConflict: 'user_id' })).error, 'Не удалось добавить nutrition goals');
  assertError((await admin.from('nutrition_settings').upsert({ user_id: clientId, meals_per_day: 4, show_macronutrients: true, track_water: true }, { onConflict: 'user_id' })).error, 'Не удалось добавить nutrition settings');
  const catalog = [
    ['Овсянка', 366, 12, 60, 7], ['Кефир', 53, 3, 4, 2.5], ['Куриное филе', 165, 31, 0, 3.6], ['Рис', 130, 2.7, 28, 0.3], ['Яйцо куриное', 143, 13, 1, 10], ['Яблоко', 52, 0.3, 14, 0.2], ['Творог', 121, 17, 3, 5], ['Овощной салат', 35, 1.5, 6, 0.4],
  ];
  const { data: products, error } = await admin.from('products').insert(catalog.map(([name, kcal, protein, carbs, fat]) => ({ owner_id: clientId, name, serving_size_g: 100, energy_kcal_per_100g: kcal, protein_g_per_100g: protein, carbohydrates_g_per_100g: carbs, fat_g_per_100g: fat }))).select('id,name');
  assertError(error, 'Не удалось добавить test products');
  const product = Object.fromEntries(products.map((row) => [row.name, row.id]));
  const meals = [
    [0, 'breakfast', 8, [['Овсянка', 70], ['Кефир', 250]]], [0, 'lunch', 13, [['Куриное филе', 180], ['Рис', 180], ['Овощной салат', 160]]], [0, 'snack', 16, [['Яблоко', 180], ['Творог', 180]]], [0, 'dinner', 20, [['Яйцо куриное', 110], ['Овощной салат', 220]]],
    [1, 'breakfast', 8, [['Овсянка', 60], ['Кефир', 200]]], [1, 'lunch', 13, [['Куриное филе', 160], ['Рис', 150]]],
  ];
  for (const [daysAgo, mealType, hour, entries] of meals) {
    const { data: meal, error: mealError } = await admin.from('meals').insert({ user_id: clientId, meal_type: mealType, eaten_at: isoAt(daysAgo, hour) }).select('id').single();
    assertError(mealError, 'Не удалось добавить test meal');
    const items = entries.map(([name, amount]) => { const source = catalog.find((item) => item[0] === name); const factor = amount / 100; return { meal_id: meal.id, user_id: clientId, product_id: product[name], product_name: name, amount_g: amount, energy_kcal: Math.round(source[1] * factor * 10) / 10, protein_g: Math.round(source[2] * factor * 10) / 10, carbohydrates_g: Math.round(source[3] * factor * 10) / 10, fat_g: Math.round(source[4] * factor * 10) / 10 }; });
    assertError((await admin.from('meal_items').insert(items)).error, 'Не удалось добавить test meal items');
  }
}

async function seedWorkouts(admin, clientId) {
  const { data: exercises, error } = await admin.from('exercises').insert([
    { user_id: clientId, name: 'Приседания', category: 'legs', measurement_type: 'reps' }, { user_id: clientId, name: 'Отжимания', category: 'chest', measurement_type: 'duration' }, { user_id: clientId, name: 'Планка', category: 'core', measurement_type: 'duration' },
  ]).select('id,name');
  assertError(error, 'Не удалось добавить test exercises');
  const byName = Object.fromEntries(exercises.map((row) => [row.name, row.id]));
  const { data: plan, error: planError } = await admin.from('workout_plans').insert({ user_id: clientId, name: 'Базовая сила', description: 'Вымышленный план для E2E-проверок.', level: 'beginner', estimated_duration_minutes: 28, is_active: true }).select('id').single();
  assertError(planError, 'Не удалось добавить test workout plan');
  const { data: planExercises, error: planExercisesError } = await admin.from('workout_plan_exercises').insert([
    { plan_id: plan.id, user_id: clientId, exercise_id: byName.Приседания, day_number: 1, sort_order: 1, target_sets: 3, target_reps_min: 12, rest_seconds: 30 }, { plan_id: plan.id, user_id: clientId, exercise_id: byName.Отжимания, day_number: 1, sort_order: 2, target_sets: 3, target_duration_seconds: 20, rest_seconds: 10 }, { plan_id: plan.id, user_id: clientId, exercise_id: byName.Планка, day_number: 1, sort_order: 3, target_sets: 2, target_duration_seconds: 30, rest_seconds: 30 },
  ]).select('id,exercise_id');
  assertError(planExercisesError, 'Не удалось добавить test plan exercises');
  const { data: completed, error: completedError } = await admin.from('workout_sessions').insert({ user_id: clientId, plan_id: plan.id, title: 'Базовая сила', status: 'completed', started_at: isoAt(1, 19), completed_at: isoAt(1, 19) }).select('id').single();
  assertError(completedError, 'Не удалось добавить completed workout');
  assertError((await admin.from('workout_sessions').insert({ user_id: clientId, plan_id: plan.id, title: 'Базовая сила', status: 'planned', started_at: isoAt(0, 19) })).error, 'Не удалось добавить planned workout');
  assertError((await admin.from('performed_sets').insert(planExercises.slice(0, 2).map((item, index) => ({ workout_session_id: completed.id, user_id: clientId, exercise_id: item.exercise_id, plan_exercise_id: item.id, exercise_name: index === 0 ? 'Приседания' : 'Отжимания', set_number: index + 1, reps: index === 0 ? 12 : null, duration_seconds: index === 1 ? 20 : null, is_completed: true, completed_at: isoAt(1, 19) })))).error, 'Не удалось добавить performed sets');
}

async function seedTrainerData(admin, ids) {
  const { data: link, error } = await admin.from('trainer_client_links').insert({ trainer_id: ids.get('trainer'), client_id: ids.get('client'), status: 'active', responded_at: new Date().toISOString() }).select('id').single();
  assertError(error, 'Не удалось создать baseline trainer link');
  assertError((await admin.from('trainer_client_notes').insert([
    { trainer_id: ids.get('trainer'), client_id: ids.get('client'), body: 'Предпочитает тренироваться вечером.' }, { trainer_id: ids.get('trainer'), client_id: ids.get('client'), body: 'На следующей неделе проверить выполнение плана.' }, { trainer_id: ids.get('trainer'), client_id: ids.get('client'), body: 'Обратить внимание на восстановление.' },
  ])).error, 'Не удалось добавить test notes');
  assertError((await admin.from('trainer_messages').insert([
    { link_id: link.id, author_id: ids.get('client'), body: 'Добрый вечер! План на сегодня выполнен.', created_at: isoAt(1, 20), seen_at: isoAt(1, 20) }, { link_id: link.id, author_id: ids.get('trainer'), body: 'Отличная работа. Завтра оставьте спокойный темп.', created_at: isoAt(1, 20) }, { link_id: link.id, author_id: ids.get('client'), body: 'Спасибо, так и сделаю.', created_at: isoAt(0, 9) }, { link_id: link.id, author_id: ids.get('trainer'), body: 'Напишите после вечерней тренировки.', created_at: isoAt(0, 10) },
  ])).error, 'Не удалось добавить test messages');
  return link.id;
}

async function reset() {
  const values = preparedEnvironment();
  if (!values.VITE_SUPABASE_URL || !values.SUPABASE_SERVICE_ROLE_KEY) fail('добавьте VITE_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.e2e.local');
  const admin = createClient(values.VITE_SUPABASE_URL, values.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const ids = await createOrVerifyAccounts(admin, values);
  await expectRegistry(admin, ids);
  await removeBaselineData(admin, ids);
  await seedProfiles(admin, ids);
  await seedNutrition(admin, ids.get('client'));
  await seedWorkouts(admin, ids.get('client'));
  await seedTrainerData(admin, ids);
  console.log('TEST FIXTURES: baseline reset complete (credentials not displayed)');
}

const command = process.argv[2] ?? 'help';
if (command === 'prepare') {
  preparedEnvironment();
  console.log('TEST FIXTURES: local credentials configured (values not displayed)');
} else if (command === 'reset') {
  await reset();
} else {
  console.log('Usage: node tools/test-fixtures.mjs prepare | reset');
  process.exitCode = 1;
}
