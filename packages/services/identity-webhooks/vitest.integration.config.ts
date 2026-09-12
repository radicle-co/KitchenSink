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
 * database and reset it, so they run serially, and the whole tier is a no-op (`describe.skipIf`) when no
 * admin server is configured, so a machine without the harness up skips rather than fails.
 *
 * The database is PROVISIONED by `tests/globalSetup.ts` under the production role model (ADR-0039) and
 * migrated by identity-service's own runner — the single source of truth for the identity schema. The
 * suites connect as `identity_service`, the role the deployed Lambdas hold.
 *
 * ⛔ The tier rebuilds `public`, so it needs a THROWAWAY server: `DATABASE_ADMIN_URL` must be loopback (the
 * harness refuses anything else) and the database it creates is its own — `identity_webhooks_test`, never
 * the one identity-service's tier uses, because two tiers sharing a database race each other's rebuild.
 */
export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
        exclude: ['node_modules', 'dist'],
        globalSetup: ['./tests/globalSetup.ts'],
        typecheck: { enabled: false },
        // One shared database + a per-file schema reset: keep the specs serial and unhurried.
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 60_000,
        passWithNoTests: true,
    },
});
