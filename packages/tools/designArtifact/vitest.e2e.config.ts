import { defineConfig } from 'vitest/config';

import { baseConfig } from '@kitchensink/vitest';

/**
 * The LOCAL e2e tier (`docs/CODING_STANDARDS.md` §7.1a): it builds the artifacts with the real adapters and renders
 * every card and board in Chromium. It runs only on a developer's machine, and its set-up throws when Chromium, the
 * React builds or the Design canvas runtime (`DESIGN_CANVAS_RUNTIME`) is missing.
 *
 * ⛔ NOT `mergeConfig(baseConfig, …)`: it concatenates `include`, so this tier would also run the unit suite.
 */
export default defineConfig({
    ...baseConfig,
    test: {
        ...baseConfig.test,
        include: ['tests/e2e/**/*.e2e.test.ts'],
        globalSetup: ['tests/e2e/globalSetup.ts'],
        // The cold build runs Tailwind and esbuild, and the first browser launch is slow.
        testTimeout: 60_000,
        hookTimeout: 300_000,
    },
});
