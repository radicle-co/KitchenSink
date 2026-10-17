import { defineConfig } from 'vitest/config';

import { localE2eAwsPin } from '@kitchensink/service-test-harness/local-aws-pin';

/** The LOCAL e2e AWS pin (`@kitchensink/service-test-harness`'s `awsPin.ts`). */
const awsPin = localE2eAwsPin(process.env);

/**
 * LOCAL e2e config for `@kitchensink/identity-webhooks` (`docs/CODING_STANDARDS.md` §7.1a).
 *
 * The webhook Lambdas own the GDPR right-to-erasure write path (FR-002 / C-007 / CR-002 R1/R3/R8): the shared
 * `eraseIdentityRow` primitive and the 12-month `tombstone-sweep` that drives it. Those seams make guarantees a
 * mock structurally CANNOT prove: that a destructive `UPDATE`/`DELETE` is bounded to the target `userId`, that the
 * `users` row is never hard-deleted (R1), that the retention predicate selects tombstoned-and-expired rows ONLY, and
 * that a mid-transaction failure rolls the whole erasure back. Only real Postgres evaluates the `WHERE`.
 *
 * The database is PROVISIONED by `tests/e2e/globalSetup.ts` under the production role model (ADR-0039) and
 * migrated by identity-service's own runner, the single source of truth for the identity schema. The suites
 * connect as `identity_service`, the role the deployed Lambdas hold. They share that database and reset it, so
 * they run serially.
 *
 * ⛔ The tier rebuilds `public`, so it needs a THROWAWAY server: `DATABASE_ADMIN_URL` must be loopback (the harness
 * refuses anything else), and the database it creates is its own, `identity_webhooks_test`.
 */
export default defineConfig({
    test: {
        env: { ...awsPin.env },
        setupFiles: [...awsPin.setupFiles],
        include: ['tests/e2e/**/*.e2e.test.ts'],
        exclude: ['node_modules', 'dist'],
        globalSetup: ['./tests/e2e/globalSetup.ts'],
        typecheck: { enabled: false },
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 60_000,
        passWithNoTests: false,
    },
});
