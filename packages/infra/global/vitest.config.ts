import { defineConfig } from 'vitest/config';

export default defineConfig({
    // ⛔ THE SOURCE ALIAS IS GONE, and the trade is stated rather than silently made.
    //
    // It used to map `@radicle-co/infra-shared/security` to that package's SOURCE, so a suite could not pass
    // against a stale `dist`. That worked while everything hoisted to one root `aws-cdk-lib`. It cannot now:
    // this package installs its own CDK, the shared source resolves the ROOT copy, and cdk-nag's Aspect from
    // one instance never visits stacks built by the other — measured, as 14 specs reporting ZERO findings
    // where they assert many. A false green, which is worse than the staleness the alias guarded against.
    //
    // ⚠️ What replaces it: CI publishes a fresh prerelease of the constructs on every run that changes them
    // and installs THAT, so the built artifact under test is always this commit's. Locally, `yalc push` after
    // editing `shared/infra` updates every consumer. `cdkNagSynth.integration.test.ts` still exercises the
    // compiled app end to end.
    test: {
        include: ['__tests__/**/*.test.ts'],
        // `tests/**` is the INTEGRATION tier (`vitest.integration.config.ts`) — excluded by path AND
        // by suffix so a `*.integration.test.ts` left in `__tests__/` cannot rejoin the unit run,
        // which is exactly how six process-spawning specs ended up racing the unit tests.
        exclude: ['tests/**', '**/*.integration.test.ts', 'node_modules', 'dist', 'cdk.out'],
        typecheck: {
            enabled: false,
        },
        // CDK stack synthesis is CPU-heavy and runs fast locally (~1s) but intermittently exceeds the
        // 5s default under the parallel turbo test load on CI runners. Give synth-backed assertions
        // realistic headroom so a slow-but-correct synth is never a false timeout failure.
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
});
