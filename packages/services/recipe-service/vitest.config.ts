import { defineConfig } from 'vitest/config';

/**
 * Unit-test config: co-located `src/**\/__tests__/*.test.ts` only. Integration
 * (`__tests__/integration/**`) and service e2e (`tests/e2e/**`) run under their own configs
 * (`vitest.integration.config.ts` / `vitest.e2e.config.ts`), and the k6 load scripts (`tests/load/**`)
 * are outside the vitest suite entirely — so the three test tiers stay cleanly separated and a plain
 * `npm run test` is unit-only (per CODING_STANDARDS §7.1).
 */
export default defineConfig({
    test: {
        include: ['src/**/*.test.ts', 'contract/**/*.test.ts'],
        // `**/__tests__/integration/**` (not just `src/**/…`) because the integration tier now uses the
        // `.integration.test.ts` suffix, which a broad include would otherwise collect into the unit run —
        // the exact bleed Constitution Principle IV forbids.
        exclude: ['infra/**', '**/node_modules/**', '**/dist/**', 'tests/**', '**/__tests__/integration/**'],
        // The CDK suites that justified this headroom now run in the sibling `infra` package, which owns
        // the `aws-cdk-lib` they import. The headroom is KEPT rather than retuned here: shrinking it
        // back to the 5s default is a separate change that needs timing evidence, and getting it wrong
        // turns a slow-but-correct test into a flaky failure.
        // Originally: the CDK half of this run synthesized stacks, CPU-heavy: fast locally
        // (~1s) but intermittently past the 5s default under the parallel turbo test load on a CI runner.
        // The cost also lands unevenly — whichever synth-backed test runs FIRST absorbs `aws-cdk-lib`'s
        // one-time initialization on top of its own work, which is why `recipeDatabaseNameParity`
        // (two synths) timed out while the test after it (six) passed. Same figure and same reason as
        // `packages/services/identity` and `packages/infra/global`, which already carry this headroom:
        // a slow-but-correct synth must never read as a failure. This does not relax any assertion —
        // nothing here asserts a duration.
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
});
