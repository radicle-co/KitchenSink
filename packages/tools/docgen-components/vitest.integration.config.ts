import { defineConfig } from 'vitest/config';

import { baseConfig } from '@kitchensink/vitest';

/**
 * The INTEGRATION tier: it builds real TypeScript programs over `packages/apps/**` and compares the result
 * with the bytes committed under `docs/generated/**`. Its own config, its own `include` and its own script,
 * per `docs/CODING_STANDARDS.md` §7 — the default `test` glob must not pick it up, or the unit tier would
 * silently become a five-package compile.
 *
 * ⛔ There is deliberately NO `test:integration` SCRIPT, which is the one place this diverges from §7's
 * shape. `packages/infra/global`'s `integrationTierWiring` guard requires every declared `test:integration`
 * script to be invoked by a named step in `_ci.yml`, because a tier no workflow calls "looks exactly like a
 * passing suite". This tier IS run in CI — the package's ordinary `test` script chains it after the unit
 * run, the same way `@commise/ui` chains its native tier — so declaring the script without the step would
 * assert an obligation the workflow does not meet, for a suite that already runs. Invoke it directly with
 * `npx vitest run --config vitest.integration.config.ts` when iterating.
 *
 * ⛔ NOT `mergeConfig(baseConfig, …)`. `mergeConfig` CONCATENATES array fields, so an `include` given here is
 * appended to the base one rather than replacing it — measured: this tier ran the unit suite a second time,
 * inside the slow config, and reported 27 passing tests where 13 belong to it. The base's other settings are
 * spread explicitly instead.
 */
export default defineConfig({
    ...baseConfig,
    test: {
        ...baseConfig.test,
        include: ['tests/**/*.integration.test.ts'],
        // This suite compiles the whole component surface twice — once to regenerate, once to prove the
        // generation is deterministic. Measured at ~8s locally; shrinking the proof to fit Vitest's 5s
        // framework default would trade the proof for the appearance of one.
        testTimeout: 180_000,
        hookTimeout: 180_000,
    },
});
