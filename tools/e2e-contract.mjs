// Shared, non-secret contract for FLUX synthetic E2E fixtures.
// The database registry remains the authority before any destructive action.
export const TEST_PERSONAS = {
  trainer: { purpose: 'trainer', env: 'TRAINER', login: 'flux-test-trainer', name: 'Артём Ветров', phone: '+79990000011', code: 'TR-TSTTRN01' },
  client: { purpose: 'client', env: 'CLIENT', login: 'flux-test-client', name: 'Илья Северин', phone: '+79990000012' },
  empty_client: { purpose: 'empty_client', env: 'EMPTY_CLIENT', login: 'flux-empty-client', name: 'Пустой Тест', phone: '+79990000013' },
  other_trainer: { purpose: 'other_trainer', env: 'OTHER_TRAINER', login: 'flux-other-trainer', name: 'Олег Каменный', phone: '+79990000014', code: 'TR-OTHTRN01' },
  workout_e2e_client: { purpose: 'client', env: 'WORKOUT_E2E_CLIENT', login: 'flux-workout-e2e-client', name: 'Workout E2E', phone: '+79990000015' },
  nutrition_e2e_client: { purpose: 'client', env: 'NUTRITION_E2E_CLIENT', login: 'flux-nutrition-e2e-client', name: 'Nutrition E2E', phone: '+79990000016' },
};

export const TEST_PERSONA_KEYS = Object.keys(TEST_PERSONAS);

// The legacy seeder remains deliberately limited to its original baseline.
// Dedicated personas are provisioned independently and are never part of its
// broad reset path.
export const SEEDED_PERSONA_KEYS = ['trainer', 'client', 'empty_client', 'other_trainer'];

// These values are deliberately shared with the fixture seeder so preflight
// checks the stable contract the tests actually rely on. EMPTY_CLIENT is a
// synthetic persona, not a globally pristine database: stateful E2E tests
// must create and clean only records carrying their own ownership marker.
export const BASELINE = {
  clientPlanName: 'Базовая сила',
};
