import { defineConfig } from 'vitest/config';

/**
 * The DEPLOYED tier (`docs/CODING_STANDARDS.md` §7.1a): the curated cookbook import, driven against one stage's real
 * recipe and food services with the test pool's curator credential. It writes recipes, so it runs only against a
 * `pr-{N}` preview, from `deployedE2eTiers.yml`'s linkage job, and it skips when no target is named. A skip is not a
 * pass.
 *
 * `fileParallelism: false` and generous timeouts: every assertion is a real round trip to a preview that runs one
 * Spot task.
 */
export default defineConfig({
    test: {
        include: ['tests/deployed/**/*.e2e.test.ts'],
        fileParallelism: false,
        testTimeout: 60_000,
        hookTimeout: 120_000,
        typecheck: { enabled: false },
    },
});
