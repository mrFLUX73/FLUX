# FLUX test contour

This is development-only infrastructure. It is never imported by the browser application and does not change the production UI.

## Personas

| Persona | Role | Baseline |
|---|---|---|
| FLUX Test Trainer | trainer | Active link with Test Client, notes and Messenger history |
| FLUX Test Client | user | Filled profile, nutrition, workout plan/history and active trainer |
| FLUX Empty Client | user | Intentionally empty; used for empty states and connection lifecycle |
| FLUX Other Trainer | trainer | Has an invite code but no link to Test Client |

The server-only `test_accounts` registry is the authority for these personas. Never use a real customer account in a fixture or smoke scenario.

## One-time local setup

1. Copy `.env.e2e.local.example` to `.env.e2e.local`, or run `pnpm e2e:prepare`.
2. Add the Supabase project URL and **service-role key** to the local file. It must remain outside Git.
3. Apply migration `0028_test_accounts_registry.sql` through the normal Supabase migration process.
4. Install the Chromium runtime once: `pnpm exec playwright install chromium`.

The reset tool generates account passwords locally if missing. It never prints them. Login names and passwords must not be placed in source, GitHub variables, frontend build variables, screenshots, or chat.

## Daily candidate check

```bash
pnpm e2e:smoke
```

The command resets only registered test fixtures, builds the production bundle, starts `vite preview` on `127.0.0.1:4179`, then runs the Playwright smoke suite. It never starts the development server. Because production Turnstile correctly rejects headless password grants on localhost, the test runner bootstraps each already-registered synthetic account with a one-time server-side magic-link session. It does not disable CAPTCHA, alter the browser bundle, or expose the service-role key to the page.

For fixture reset alone:

```bash
pnpm e2e:reset
```

## Baseline freshness

The baseline is relative to the moment of reset: today contains the full diary,
yesterday contains the partial diary, and the day before yesterday is empty.
Before a **full** smoke run, compare the current calendar day with the last
fixture reset. If the day has changed, run the authorised synthetic-only reset
first. Do not reset again during the same calendar day unless the scenario
itself has changed fixture data.

## Safety contract

- Reset verifies every expected account and purpose in `test_accounts` before destructive work.
- It deletes a trainer link only when **both** participants are test accounts.
- It does not accept a browser supplied user id.
- Service-role access exists only in the Node fixture script and `.env.e2e.local`; it is not a Vite variable and cannot enter `dist`.
- Pending, decline, accept, revoke and message writes use Empty Client/Test Trainer, then reset back to baseline.

## Real-device boundary

Playwright checks browser runtime, navigation, layout and overflow. iPhone Safari, PWA installation, keyboard, safe-area, QR camera and permission dialogs remain manual device checks.
