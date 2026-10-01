import { defineConfig } from 'vitest/config';

/**
 * The cross-service E2E tier: specs that drive TWO live services over HTTP at once.
 *
 * It is its own tier, in its own package, deliberately. The proof it carries — that recipe-service
 * resolves an ingredient against a REAL food-service record and derives a recipe's nutrition from that
 * live lookup — belongs to neither service: putting it in recipe's suite would make recipe's tier depend
 * on food's runtime, and putting it in food's would have food asserting recipe's wire contract. It also
 * cannot be dragged into another job by a glob, which is what keeps `_ci.yml`'s existing tiers (all of
 * which point `FOOD_SERVICE_URL` at a dead port ON PURPOSE, to prove the ABSENT-dependency degradation)
 * exactly as they are.
 *
 * `fileParallelism: false` because the specs share two booted services and one pair of databases.
 * Timeouts are generous: every assertion is a real HTTP round trip across two Nest apps and Postgres.
 */
export default defineConfig({
    test: {
        include: ['tests/e2e/**/*.e2e.test.ts'],
        fileParallelism: false,
        testTimeout: 60_000,
        hookTimeout: 120_000,
        typecheck: {
            enabled: false,
        },
    },
});
