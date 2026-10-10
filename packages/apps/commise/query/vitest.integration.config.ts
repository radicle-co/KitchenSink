import { defineConfig } from 'vitest/config';

/**
 * Vitest config for @commise/query's INTEGRATION tier (`tests/__integration__/`).
 *
 * Its own config and script because §7 keeps every non-unit tier out of the default `test` task (the unit config's
 * `src/**​/__tests__` glob does not reach `tests/`). These suites COMPOSE the offline write path from its real parts —
 * `SyncProvider`, the outbox mutator and drainer from `@kitchensink/sync`, `recipeSender`, and the real
 * `RecipeServiceClient` with its zod parsing — and mock only what is outside the package: the network, as a `fetch`
 * double (owner ruling 2026-09-20: integration tests mock their dependencies). They run in CI via
 * `npm run test:integration --workspace=@commise/query`.
 *
 * `jsdom` for the reason the unit config gives: TanStack's `onlineManager` and React's renderer expect a `window`.
 */
export default defineConfig({
    test: {
        environment: 'jsdom',
        include: ['tests/__integration__/**/*.integration.test.{ts,tsx}'],
        exclude: ['node_modules', 'dist'],
        testTimeout: 15_000,
    },
});
