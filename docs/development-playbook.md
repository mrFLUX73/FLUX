# FLUX Development Playbook

Use this playbook proportionally: it applies in full before browser E2E,
destructive synthetic work, migrations and meaningful product changes. It is
not a ritual for copy edits, small isolated CSS fixes or read-only analysis.

## Classify a failure first

Before changing product code, identify one class:

- **PRODUCT** — a real user-facing defect.
- **TEST** — stale scenario, wrong locator/expectation, or a test race.
- **INFRASTRUCTURE** — stale preview, wrong E2E environment, auth, port,
  runner or synthetic baseline.

Do not change product code until PRODUCT is established. Fix the smallest
cause and re-run the smallest affected scenario first.

## Browser E2E contract

Run `pnpm e2e:preflight` only against a prepared E2E candidate preview, or
use `pnpm e2e:targeted <spec-or-playwright-args>`, which builds it, starts a
managed preview, runs preflight, and only then starts Playwright.

Preflight must pass before browser E2E. It verifies local configuration, the
actual test-build marker, a fingerprint of current browser build inputs, the
preview served on the expected port, synthetic registry/auth, and the minimum
fixture baseline. A port responding by itself is not proof of a valid preview.

Use this sequence:

`preflight → targeted E2E → classify → minimal fix → targeted re-run → relevant regression`

Do not repeat a full smoke or already-confirmed regression unless the new
change reaches it. Auth-sensitive tests remain sequential (`--workers=1`) until
safe parallelism is demonstrated. If a shell loses its Playwright attachment,
inspect the worker, preview and artifacts before launching a second run.

## Synthetic data and service-role safety

Real accounts are never destructive fixtures. Only registry-owned synthetic
accounts in `test_accounts` may be reset. Service-role scripts bypass RLS and
are privileged: registry validation is therefore mandatory and must fail
closed. If an operation cannot prove every target is synthetic, do not run it.

Tests should create identifiable data where practical; reset is a safety net,
not a substitute for isolation. If a scenario needs fixture state, preflight
must validate the corresponding baseline and postconditions must be clear.
Never print or commit passwords, session tokens, service-role keys,
storage-state or screenshots containing secrets.

## UI, locators and state machines

Wait for observable UI state after an action — a loaded entity, changed CTA,
finished loading or server-backed data — not merely for `click()` to resolve.
Prefer roles, accessible names and the intended interactive element. Scope
repeated text to its context; do not use a hero heading as a proxy action.

An explicit state machine owns user-state transitions. Hydration, sync and
load effects may restore data but must not independently transition that state
machine. Lesson from #122: a loader effect reset REST and cleared an active
rest timer.

Test each entity type both for its own behavior and for absence of another
type's behavior. For workouts: reps must not inherit a duration timer;
duration must support start/pause/resume; distance must not inherit timer state
without a time target. #122 caught a shared timer effect that put a strength
set into PAUSED.

## Server contracts and resource use

Do not create a migration, alter RPC or change schema for a UI/state issue
until the current server contract is proven insufficient. Choose the smallest
verification set that gives confidence; avoid full smoke runs for local work.

When a recurring issue is found, ask whether it is a class of errors, whether
a regression test or preflight can prevent it, and whether this playbook needs
a short new rule. Do not turn this document into a bug log or changelog.
