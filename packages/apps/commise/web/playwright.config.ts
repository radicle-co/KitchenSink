import nextEnv from '@next/env';
import { defineConfig, devices } from '@playwright/test';

import { AUTH_STATE_PATH, SESSION_OWNING_SPEC_GLOBS } from './tests/e2e/utils/authState';
import { resolveWebServerMode, webServerCommand } from './tests/e2e/utils/webServerMode';

// @next/env is CommonJS — destructure off the default import (named ESM imports fail).
const { loadEnvConfig } = nextEnv;

// Load .env.local for local runs — clerkSetup() + the test-user provisioning read the Clerk dev keys
// from process.env, and the dev server needs them too. In CI the keys are already in process.env
// (load-secrets) and there is no .env.local, so this is a no-op there.
loadEnvConfig(process.cwd());

// Since the ADR-0001 subdomain cutover, previews serve at the ROOT (empty basePath) with the locale in
// the path (`/{locale}/…`). The suite runs the dev server in that live shape by default: no basePath, so
// the middleware locale redirect isn't fighting a basePath, and every route lives under `/{locale}`. The
// legacy per-PR basePath double-prefix bug class is retired with path routing.
const BASE_PATH = process.env.E2E_BASE_PATH ?? '';
const LOCALE = process.env.E2E_LOCALE ?? 'en';
const PORT = Number(process.env.PORT ?? 3000);
const ORIGIN = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

// `dev` locally, `start` (a real production build) under CI. The whole rationale — including the measured
// per-test cost of on-demand route compilation that made this a reliability problem rather than a speed one —
// lives in `tests/e2e/utils/webServerMode.ts`, next to the guard that pins it.
const WEB_SERVER_MODE = resolveWebServerMode(process.env);

export default defineConfig({
    testDir: './tests/e2e',
    // Only `*.spec.ts` are Playwright specs (project convention). The default testMatch also grabs
    // `*.test.ts`, which would wrongly try to run co-located VITEST unit tests (e.g. the e2e utils'
    // readViewerAppId.test.ts) as Playwright specs and crash the run on their `vitest` imports.
    testMatch: '**/*.spec.ts',
    // Serial (single worker), not parallel: this run's specs share ONE Clerk test user (run-scoped — see
    // tests/e2e/utils/runFixtureIdentity.ts) and ONE Next server, and concurrent sign-ins — plus, in `dev`
    // mode, on-demand route compilation — under load flake intermittently. Reliability matters more than
    // wall-clock for a red-alert auth suite. NOTE: this says nothing about two SEPARATE runs — those are
    // isolated by the per-run fixture identity, not by the worker count.
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 1,
    workers: 1,
    // 60s, not Playwright's 30s default. Almost every spec here opens with `signInWithTicket`, whose own
    // landing poll budgets 30s to absorb the Clerk handshake — and, in `dev` mode, Next's on-demand route
    // compilation on top of it. That is EXACTLY the default
    // per-test budget. A step whose timeout equals the whole test's budget can never report its own
    // failure: the test dies of a generic 30s timeout first, which is how the `signInWithTicket` flake
    // presents (a bare timeout on the sign-in step, with no indication of which precondition missed).
    // Raising the cap makes that inner poll strictly smaller than the enclosing budget, so the helper's
    // diagnostic is reachable, and leaves headroom for the Clerk round-trips that follow. It is not a
    // licence for slow tests: the suite averages ~4s per test, so 60s only bites on genuine pathology,
    // and `test.slow()` still triples it for the two flows that legitimately need more.
    timeout: 60_000,
    reporter: 'html',
    // globalSetup resolves this run's fixture identity, PINS it into process.env (the workers inherit it),
    // and provisions the run's Clerk user.
    globalSetup: './tests/e2e/global.setup.ts',
    // Deletes THIS RUN's Clerk users (cascades to a DB purge via the user.deleted webhook) plus an
    // age-gated sweep of leaks from crashed runs — never a concurrent run's live fixture.
    globalTeardown: './tests/e2e/global.teardown.ts',
    use: {
        baseURL: ORIGIN,
        trace: 'on-first-retry',
    },
    // ── THREE projects, because ONE shared Clerk session is not safe for every spec ────────────────────
    //
    // `setup` signs in once and saves `storageState`; `chromium` restores it; `own-session` deliberately does
    // not. The split is defined ONCE, by `SESSION_OWNING_SPECS` — used here as one project's `testMatch` and
    // the other's `testIgnore`, so a spec cannot land in both projects or in neither. See
    // `tests/e2e/utils/authState.ts` for the reasoning and `tests/e2e/utils/__tests__/authState.test.ts` for
    // the guard that re-derives this partition from the files on disk.
    //
    // ⚠️ THE MAIN PROJECT MUST STAY NAMED `chromium`. Playwright bakes the project name into screenshot
    // baselines (`recipe-detail-desktop-chromium-linux.png`), so renaming it — or moving a spec that owns a
    // `-snapshots/` directory into `own-session` — silently invalidates those baselines.
    //
    // ⚠️ `dependencies` RE-RUNS `setup` in every shard. That is correct here rather than wasteful: each shard
    // derives its own run key (`COMMISE_E2E_SHARD` → `deriveRunKey`) and provisions its own Clerk user, so a
    // shard must authenticate as ITS user and write ITS own state file (`authStatePath` is run-key scoped). One
    // shared file would hand shard 2 a session belonging to a user shard 1's teardown then deletes.
    projects: [
        {
            name: 'setup',
            testMatch: /auth\.setup\.ts$/,
            use: { ...devices['Desktop Chrome'] },
        },
        {
            // Every signed-in spec. Restores the shared session; `signInWithTicket` becomes a navigation.
            name: 'chromium',
            testIgnore: SESSION_OWNING_SPEC_GLOBS,
            use: { ...devices['Desktop Chrome'], storageState: AUTH_STATE_PATH },
            dependencies: ['setup'],
        },
        {
            // Specs that revoke their session or assert the signed-OUT surface. No `storageState`, and no
            // dependency on `setup` — they mint their own session exactly as the whole suite used to, so a
            // failure here is never a symptom of the shared one.
            name: 'own-session',
            testMatch: SESSION_OWNING_SPEC_GLOBS,
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: process.env.PLAYWRIGHT_BASE_URL
        ? undefined
        : {
              // `next dev` locally, `next start` under CI — see tests/e2e/utils/webServerMode.ts.
              //
              // ⚠️ `start` SERVES A BUILD; it does not make one. CI's `build` job publishes `.next` as an
              // artifact and the Playwright job downloads it. Locally, run `npm run build` first (with the
              // three NEXT_PUBLIC_* values this app requires) or leave the mode at `dev`.
              command: webServerCommand(WEB_SERVER_MODE),
              // Empty basePath (subdomain shape) unless E2E_BASE_PATH pins a legacy prefix; the locale
              // lives in the path. PREVIEW_BASE_PATH is only set when exercising the legacy path shape.
              //
              // ⚠️ PREVIEW_BASE_PATH IS BUILD-TIME AND HAS NO EFFECT ON A `start` RUN. `next.config.ts`
              // reads it through `derivePreviewBasePath` while the bundle is being COMPILED, so the prefix
              // is already baked (or absent) in whatever `.next` this server is about to serve — passing it
              // here only reaches an already-built app, which ignores it. CI runs the BARE shape only (no
              // workflow sets E2E_BASE_PATH or PREVIEW_BASE_PATH), so nothing is lost today. If the legacy
              // prefixed preview shape is ever wired into CI it needs its OWN build, made with
              // PREVIEW_BASE_PATH set — it cannot share the bare artifact. See ADR-0001.
              env: BASE_PATH ? { PREVIEW_BASE_PATH: BASE_PATH, PORT: String(PORT) } : { PORT: String(PORT) },
              // Readiness probe: the localized sign-in page returns 200 (`/sign-in` 307s to `/{locale}`).
              url: `http://localhost:${PORT}${BASE_PATH}/${LOCALE}/sign-in`,
              reuseExistingServer: !process.env.CI,
              timeout: 120_000,
          },
});
