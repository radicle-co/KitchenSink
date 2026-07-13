import nextEnv from '@next/env';
import { defineConfig, devices } from '@playwright/test';

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

export default defineConfig({
    testDir: './tests/e2e',
    // Serial (single worker), not parallel: these auth flows share ONE Clerk test user and ONE Next
    // dev server, and concurrent sign-ins / on-demand route compilation under load flake intermittently.
    // Reliability matters more than wall-clock for a red-alert auth suite (~40s serially).
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 1,
    workers: 1,
    reporter: 'html',
    globalSetup: './tests/e2e/global.setup.ts',
    // Delete the e2e users from Clerk after the run (cascades to a DB purge via the user.deleted webhook).
    globalTeardown: './tests/e2e/global.teardown.ts',
    use: {
        baseURL: ORIGIN,
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: process.env.PLAYWRIGHT_BASE_URL
        ? undefined
        : {
              command: 'npm run dev',
              // Empty basePath (subdomain shape) unless E2E_BASE_PATH pins a legacy prefix; the locale
              // lives in the path. PREVIEW_BASE_PATH is only set when exercising the legacy path shape.
              env: BASE_PATH ? { PREVIEW_BASE_PATH: BASE_PATH, PORT: String(PORT) } : { PORT: String(PORT) },
              // Readiness probe: the localized sign-in page returns 200 (`/sign-in` 307s to `/{locale}`).
              url: `http://localhost:${PORT}${BASE_PATH}/${LOCALE}/sign-in`,
              reuseExistingServer: !process.env.CI,
              timeout: 120_000,
          },
});
