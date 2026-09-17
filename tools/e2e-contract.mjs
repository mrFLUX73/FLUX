// Shared, non-secret contract for FLUX synthetic E2E fixtures.
// The database registry remains the authority before any destructive action.
export const TEST_PERSONAS = {
  trainer: { purpose: 'trainer', env: 'TRAINER', login: 'flux-test-trainer', name: 'Артём Ветров', phone: '+79990000011', code: 'TR-TSTTRN01' },
  client: { purpose: 'client', env: 'CLIENT', login: 'flux-test-client', name: 'Илья Северин', phone: '+79990000012' },
  empty_client: { purpose: 'empty_client', env: 'EMPTY_CLIENT', login: 'flux-empty-client', name: 'Пустой Тест', phone: '+79990000013' },
  other_trainer: { purpose: 'other_trainer', env: 'OTHER_TRAINER', login: 'flux-other-trainer', name: 'Олег Каменный', phone: '+79990000014', code: 'TR-OTHTRN01' },
};

export const TEST_PURPOSES = Object.keys(TEST_PERSONAS);

// These values are deliberately shared with the fixture seeder so preflight
// checks the contract the tests actually rely on, rather than a second guess.
export const BASELINE = {
  clientPlanName: 'Базовая сила',
  emptyClientPlanCount: 0,
};
