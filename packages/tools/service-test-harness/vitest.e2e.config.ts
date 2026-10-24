import { defineConfig } from 'vitest/config';

import { localE2eAwsPin } from '@kitchensink/service-test-harness/local-aws-pin';

/** The LOCAL e2e AWS pin (`@kitchensink/service-test-harness`'s `awsPin.ts`). */
const awsPin = localE2eAwsPin(process.env);

/**
 * LOCAL e2e config (`docs/CODING_STANDARDS.md` §7.1a) for the harness's own fixtures: real PostgreSQL, named by
 * `DATABASE_ADMIN_URL`. It never skips.
 *
 * Separate from the default `test` task (which is unit-only) for the reason every package here keeps them
 * apart: a DB-backed spec must never bleed into the unit run. `fileParallelism: false` because these
 * provision cluster-global roles under one advisory lock, and `hookTimeout` is generous because a first run
 * creates roles, a database and a schema.
 */
export default defineConfig({
    test: {
        env: { ...awsPin.env },
        setupFiles: [...awsPin.setupFiles],
        include: ['tests/e2e/**/*.e2e.test.ts'],
        passWithNoTests: false,
        fileParallelism: false,
        hookTimeout: 120_000,
        testTimeout: 60_000,
    },
});
