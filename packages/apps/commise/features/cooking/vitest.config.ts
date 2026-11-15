import { jsdomPolyfillsSetup } from '@kitchensink/vitest';
import { defineConfig } from 'vitest/config';

/**
 * Default (web) test config for the cooking feature. Runs the `.test.ts(x)` specs under jsdom. Native specs
 * (`*.native.test.tsx`) are excluded here and owned by `vitest.native.config.ts`; `npm test` runs both.
 */
export default defineConfig({
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: [jsdomPolyfillsSetup],
        include: ['**/__tests__/**/*.test.{ts,tsx}'],
        // Above `ASYNC_UTIL_TIMEOUT_MS` (`@commise/test-utils/async-util-budget`).
        testTimeout: 15_000,
        exclude: ['node_modules', 'dist', '**/*.native.test.tsx'],
    },
});
