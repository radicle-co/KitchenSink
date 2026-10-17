import { jsdomPolyfillsSetup } from '@kitchensink/vitest';
import { defineConfig } from 'vitest/config';

/**
 * Vitest config for @commise/features-recipes' INTEGRATION tier (`tests/__integration__/`).
 *
 * Its own config and script because §7 keeps every non-unit tier out of the default `test` task (the unit config's
 * `__tests__` glob does not reach `tests/`). These suites COMPOSE the feature's real modules — the leaf, the hooks,
 * TanStack Query and the real `RecipeServiceClient` with its zod parsing — and mock only what is outside the
 * package: the network, as a `fetch` double (owner ruling 2026-09-20: integration tests mock their dependencies).
 * They run in CI via `npm run test:integration --workspace=@commise/features-recipes`.
 */
export default defineConfig({
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: [jsdomPolyfillsSetup, './vitest.setup.ts'],
        include: ['tests/__integration__/**/*.integration.test.{ts,tsx}'],
        // Above `ASYNC_UTIL_TIMEOUT_MS` (`@commise/test-utils/async-util-budget`).
        testTimeout: 15_000,
        exclude: ['node_modules', 'dist'],
    },
});
