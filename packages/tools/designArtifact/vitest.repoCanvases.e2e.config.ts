import { defineConfig } from 'vitest/config';

import { baseConfig } from '@kitchensink/vitest';

/**
 * The LOCAL e2e tier for the repo-source canvases (`docs/CODING_STANDARDS.md` §7.1a). It renders the committed boards in
 * Chromium and needs no build, so it has its own set-up and does not wait for the artifacts' cold build. It runs only on
 * a developer's machine, and its set-up throws when Chromium or the Design canvas runtime (`DESIGN_CANVAS_RUNTIME`) is
 * missing.
 *
 * ⛔ NOT `mergeConfig(baseConfig, …)`: it concatenates `include`, so this tier would also run the unit suite.
 */
export default defineConfig({
    ...baseConfig,
    test: {
        ...baseConfig.test,
        include: ['tests/e2e/renderRepoCanvases.e2e.test.ts'],
        globalSetup: ['tests/e2e/repoCanvasesSetup.ts'],
        testTimeout: 60_000,
        hookTimeout: 120_000,
    },
});
