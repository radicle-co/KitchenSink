import nextEnv from '@next/env';
import { defineConfig, devices } from '@playwright/test';

// @next/env is CommonJS — destructure off the default import (named ESM imports fail).
const { loadEnvConfig } = nextEnv;

// Load .env.local for local runs — clerkSetup() + the test-user provisioning read the Clerk dev keys
// from process.env, and the dev server needs them too. In CI the keys are already in process.env
// (load-secrets) and there is no .env.local, so this is a no-op there.
loadEnvConfig(process.cwd());

// The auth flow's worst bug class is PREVIEW-ONLY: under a per-PR basePath, Clerk's post-auth redirect
// double-prefixes to /pr-{N}/pr-{N}/ and strands the user. It does NOT reproduce without a basePath,
// so the e2e suite runs the dev server UNDER one by default. Override with E2E_BASE_PATH='' to also
// exercise the production (no-prefix) shape. When pointing at a deployed preview via
// PLAYWRIGHT_BASE_URL, set E2E_BASE_PATH to that preview's prefix (e.g. /pr-39).
const BASE_PATH = process.env.E2E_BASE_PATH ?? '/pr-e2e';
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
              // Serve the dev server under the same basePath the tests navigate against.
              env: { PREVIEW_BASE_PATH: BASE_PATH, PORT: String(PORT) },
              // Readiness probe: the sign-in page lives under the basePath and returns 200.
              url: `http://localhost:${PORT}${BASE_PATH}/sign-in`,
              reuseExistingServer: !process.env.CI,
              timeout: 120_000,
          },
});
