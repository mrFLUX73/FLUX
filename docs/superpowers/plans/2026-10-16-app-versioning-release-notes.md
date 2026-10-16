# FLUX App Versioning & Release Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each published FLUX build identifiable by semantic version, build number, commit SHA, build date, and structured release notes.

**Architecture:** Keep the package version as the sole semantic-version source. Vite injects that version and GitHub Actions build metadata into the bundle; a small client metadata module converts those values into a safe published-or-local display model. The existing profile dialog remains the single release-notes surface and gains structured version metadata plus a copyable commit.

**Tech Stack:** React 19, TypeScript, Vite 8, GitHub Actions, Node built-in test runner.

**Spec:** `/Users/kvadratik/.codex/attachments/1837913e-dbbc-4740-b5a1-bed6a27983da/Вставленный текст.txt`

## Global Constraints

- Do not change Workout Engine V3, Nutrition, Trainer, Supabase, RPC, RLS, or user data.
- Do not add dependencies, commit, push, deploy, or apply migrations.
- Preserve legacy build-history entries and manual opening of the existing “Что нового” dialog.
- Production metadata must be compiled into the bundle; local builds must not impersonate a production build.

## Review Focus

- Missing or malformed CI metadata must render as a local build, never `undefined` or a fictitious SHA.
- A release note must be tied to an intentional semantic version, not automatically invented per workflow run.
- Long commit or release-note text must remain contained at 320 px without horizontal overflow.
- The copy action must stay keyboard-accessible and announce completion.
- No automatic opening or persisted update-prompt state may be introduced.

### Task 1: Define and test safe build metadata

**Files:**
- Create: `src/lib/appMetadata.ts`
- Create: `src/lib/appMetadata.test.ts`
- Modify: `vite.config.ts`, `src/vite-env.d.ts`, `package.json`, `.github/workflows/deploy.yml`

- [ ] Write a Node built-in test for complete CI metadata and local/malformed fallbacks; run it and observe failure before the module exists.
- [ ] Add a pure metadata normalizer returning semantic version plus nullable build/SHA/date fields and `isPublished` only when all CI identifiers are valid.
- [ ] Inject package.json version and existing CI metadata through Vite defines; remove the duplicated workflow app-version literal.
- [ ] Run the metadata test, `pnpm tsc -b`, and local build.

### Task 2: Structure release notes and extend the existing profile dialog

**Files:**
- Modify: `src/lib/buildHighlights.ts`, `src/features/profile/ProfileScreen.tsx`, `src/styles.css`

- [ ] Add structured version/date-aware release-note data for the intentional 0.2.0 Workout Engine V3 release while preserving legacy build history.
- [ ] Replace fallback marketing copy with a neutral unavailable-notes state.
- [ ] Add a compact profile “FLUX” entry and expose version, build, localized publication date, and copyable SHA in the existing dialog.
- [ ] Keep manual opening, history, and no-auto-popup behavior intact.

### Task 3: Verify compiled metadata and responsive output

**Files:**
- Test: `src/lib/appMetadata.test.ts`

- [ ] Build with explicit CI metadata and inspect the output for exact version/build/SHA/date values.
- [ ] Run `pnpm tsc -b`, `pnpm build`, and `git diff --check`.
- [ ] Run available UI checks; if managed browser credentials are unavailable, report visual mobile verification as not run rather than passed.
