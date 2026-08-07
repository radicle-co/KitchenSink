import { defineConfig } from 'vitest/config';

/**
 * Integration-test config for `@kitchensink/identity-webhooks`.
 *
 * The webhook Lambdas own the GDPR right-to-erasure write path (FR-002 / C-007 / CR-002 R1/R3/R8): the
 * shared `eraseIdentityRow` primitive and the 12-month `tombstone-sweep` that drives it. Those seams make
 * guarantees a drizzle-shaped mock structurally CANNOT prove — that a destructive `UPDATE`/`DELETE` is
 * bounded to the target `userId`, that the `users` row is never hard-deleted (R1), that the retention
 * predicate selects tombstoned-and-expired rows ONLY, and that a mid-transaction failure rolls the whole
 * erasure back. A mock records the calls; only real Postgres evaluates the `WHERE`.
 *
 * Mirrors the identity service's integration config (`packages/services/identity`): the specs share one
 * database and reset it, so they run serially, and the whole tier is a no-op (`describe.skipIf`) when
 * `DATABASE_URL` is unset so a machine without the harness up skips rather than fails.
 *
 * The schema is applied ONCE per run by `tests/global-setup.ts` from identity-service's ordered migration
 * SQL — the single source of truth for the identity schema.
 *
 * DANGER: this tier DROPS and recreates the `public` schema on whatever `DATABASE_URL` points at. Point it
 * at a THROWAWAY database (`kitchensink_identity_webhooks_it`), never a live/dev one, and never at the
 * database the identity service's own integration tier uses — two tiers sharing one database race each
 * other's schema reset.
 */
export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
        exclude: ['node_modules', 'dist'],
        globalSetup: ['./tests/global-setup.ts'],
        typecheck: { enabled: false },
        // One shared database + a per-file schema reset: keep the specs serial and unhurried.
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 60_000,
        passWithNoTests: true,
    },
});
