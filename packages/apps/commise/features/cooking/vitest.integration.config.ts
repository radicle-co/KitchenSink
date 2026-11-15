import { jsdomPolyfillsSetup } from '@kitchensink/vitest';
import { defineConfig } from 'vitest/config';

/**
 * Integration test config for `@commise/features-cooking` (web lane).
 *
 * These specs import the package by its own name, so they run through the `exports` map and `src/index.ts`: the real
 * session hook over the real `@kitchensink/cooking-core` reducers and the real resolved `@commise/i18n` messages.
 * Only the browser's wake lock is stood in for. Kept OUT of the default `test` task (whose glob does not reach `tests/`)
 * so a case never runs in both tiers. Self-contained: no Docker, no network. CI runs it with
 * `npm run test:integration --workspace=@commise/features-cooking`.
 */
export default defineConfig({
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: [jsdomPolyfillsSetup],
        include: ['tests/__integration__/**/*.integration.test.{ts,tsx}'],
        exclude: ['node_modules', 'dist', '**/*.native.integration.test.tsx'],
        // Above `ASYNC_UTIL_TIMEOUT_MS` (`@commise/test-utils/async-util-budget`).
        testTimeout: 15_000,
    },
});
