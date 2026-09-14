import { defineConfig } from 'vitest/config';

/**
 * Integration tier for the global infra package — the specs that spawn real processes.
 *
 * ⛔ WHY THIS FILE EXISTS, AND THE OUTAGE-SHAPED BUG THAT CAME OF NOT HAVING IT.
 *
 * These six specs were named `*.integration.test.ts` but lived in `__tests__/`, which the default config's
 * `__tests__/**\/*.test.ts` glob matches — so they ran inside the UNIT tier, in parallel with every unit
 * file in the package. They are not unit tests by any measure: they run `npm run bundle:lambda`, `turbo run
 * build`, `cdk synth` in child processes, esbuild, and shell scripts against real fixtures.
 *
 * One of them, `cdkNagSynth.integration.test.ts`, CREATES `dist-lambda/` in the package root as a side
 * effect of bundling. `cdkNagTemplateParity.test.ts` — running concurrently, in another worker —
 * synthesizes the platform twice and asserts the two templates are byte-identical. `DataStack` probed that
 * directory to choose between the real asset and its inline stub, so when the bundle landed between the two
 * synths the same app emitted `"codeSource": "inline-stub"` and then `"codeSource": "bundle"`, and the
 * ADR-0002 no-prod-diff proof failed on a diff nobody wrote. It reproduced in a ~150ms window, which is why
 * it passed locally and fired on a 2-core runner.
 *
 * The probe is now pinned (`LAMBDA_ASSET_CANDIDATES` in `DataStack.ts`), so that specific race is closed at
 * the source. This file closes the CLASS: a tier that shells out to builds and writes into the package root
 * must not share a process pool with tests that read it. `fileParallelism: false` is the other half — these
 * specs contend for the same `dist-lambda/`, `dist/` and `cdk.out/`, so running them serially is a
 * correctness requirement here rather than a tuning choice.
 *
 * Timeouts are generous because the work is real: a build, a bundle and two CLI synths of the whole
 * platform app, each walking every construct twice.
 */
export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
        fileParallelism: false,
        hookTimeout: 600_000,
        testTimeout: 120_000,
        typecheck: {
            enabled: false,
        },
    },
});
