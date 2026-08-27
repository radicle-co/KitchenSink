import { testTempRootSetup } from '@kitchensink/vitest';
import { defineConfig } from 'vitest/config';

/**
 * Integration tier for `@kitchensink/recipe-import-core`. These specs run the REAL third-party parsers
 * over a committed slice of real 1919 cookbook text and assert every resolved value against the REAL
 * `@kitchensink/recipe-core` schemas that guard the persisted columns — the seam a mocked unit test
 * cannot cross. Self-contained: no Docker, no network, no external service.
 *
 * Kept OUT of the default `test` task (whose glob is `**\/__tests__/**`) so it never bleeds into the
 * unit run; it runs via `npm run test:integration` (CODING_STANDARDS §7).
 */
export default defineConfig({
    test: {
        // ⛔ Confines this run's temp directories to one removable root — CDK's own `cdk.out*`
        // synth dirs and every `mkdtempSync(tmpdir())` fixture. Asserted by `vitestTempRoot.test.ts`.
        globalSetup: [testTempRootSetup],
        include: ['tests/**/*.integration.test.ts'],
        typecheck: { enabled: false },
    },
});
