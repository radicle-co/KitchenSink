import { testTempRootSetup } from '@kitchensink/vitest';
import { defineConfig } from 'vitest/config';

/**
 * ⛔ `environment: 'jsdom'` IS LOAD-BEARING HERE, not boilerplate copied from the component packages — this
 * package contains no components at all.
 *
 * TanStack's own retry default is `config.retry ?? (isServer ? 0 : 3)`, and `isServer` is
 * `typeof window === 'undefined'`. Under vitest's default `node` environment a BARE `new QueryClient()`
 * therefore retries nothing, so `queryClient.test.ts`'s "a 404 costs exactly one request" would pass against
 * the very client `createAppQueryClient` replaces — a green assertion proving nothing. jsdom supplies a
 * `window`, which puts the default back at 3 and makes that count falsifiable.
 */
export default defineConfig({
    test: {
        // ⛔ Confines this run's temp directories to one removable root — asserted by `vitestTempRoot.test.ts`.
        globalSetup: [testTempRootSetup],
        environment: 'jsdom',
        include: ['src/**/__tests__/**/*.test.ts'],
        exclude: ['node_modules', 'dist'],
    },
});
