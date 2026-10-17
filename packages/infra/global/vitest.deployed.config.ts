import { defineConfig } from 'vitest/config';

/**
 * DEPLOYED e2e config (`docs/CODING_STANDARDS.md` §7.1a): suites that probe a real deployed origin, named by an env
 * variable a workflow sets. They prove the deploy, and only `prod-deploy.yml` switches them on
 * (`prodDeploySmokeDepth.test.ts` holds that pairing).
 */
export default defineConfig({
    test: {
        include: ['tests/deployed/**/*.e2e.test.ts'],
        fileParallelism: false,
        testTimeout: 60_000,
        hookTimeout: 60_000,
        typecheck: { enabled: false },
    },
});
