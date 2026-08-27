import { testTempRootSetup } from '@kitchensink/vitest';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

const srcPath = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
    plugins: [react()],
    test: {
        // ⛔ Confines this run's temp directories to one removable root — CDK's own `cdk.out*`
        // synth dirs and every `mkdtempSync(tmpdir())` fixture. Asserted by `vitestTempRoot.test.ts`.
        globalSetup: [testTempRootSetup],
        include: [
            'tests/**/*.test.ts',
            'tests/**/*.test.tsx',
            'src/**/__tests__/**/*.test.ts',
            'src/**/__tests__/**/*.test.tsx',
            'router/tests/**/*.test.ts',
            'infra/__tests__/**/*.test.ts',
            'scripts/__tests__/**/*.test.ts',
        ],
        // The integration tier owns `tests/__integration__/` and runs from `vitest.integration.config.ts`
        // (Constitution Principle IV: integration tests MUST NOT bleed into the default `test` task).
        // Without this exclude the `tests/**/*.test.ts(x)` globs above swallow them back into the unit run.
        exclude: ['node_modules', 'dist', 'tests/__integration__/**'],
        environment: 'jsdom',
        setupFiles: ['./tests/setup.ts'],
        globals: true,

        // `infra/__tests__` SYNTHESIZES the sandbox router CDK stack, which is CPU-heavy: fast locally (~1s)
        // but intermittently past the 5s default under the parallel turbo test load on a CI runner, and the
        // first synth-backed test in a file also absorbs `aws-cdk-lib`'s one-time initialization. Same figure
        // and same reason as `packages/services/identity` and `packages/infra/global`, which already carry
        // this headroom, so a slow-but-correct synth never reads as a failure. This is deliberately NOT a
        // licence for the jsdom component suites in this same run to lean on it: those must synchronize on
        // state (`waitFor`/`findBy*`), never on elapsed time, and none of them asserts a duration.
        testTimeout: 30_000,
        hookTimeout: 30_000,

        // `src/config/env.ts` validates the app's endpoints at MODULE LOAD and has no defaults, so any
        // test that transitively imports a service client would otherwise die with a configuration error.
        //
        // These are stated here rather than read from the committed `.env.development` because vitest runs
        // with NODE_ENV=test, and Next's own `.env.$(NODE_ENV)` loader — the thing that reads that file —
        // is not running. Next also deliberately skips `.env.development` under `test`. Declaring them
        // explicitly keeps the unit tier hermetic and matches how CI states the same two values for the
        // Playwright job.
        //
        // Values are irrelevant to assertions: every suite that touches the network intercepts it. What
        // matters is only that configuration is PRESENT, so a suite failing means the code is wrong rather
        // than the environment being unset. `src/config/__tests__/env.test.ts` overrides these per-case to
        // prove the missing/blank/relative paths still fail loudly.
        env: {
            NEXT_PUBLIC_RECIPE_API_URL: 'http://localhost:3000',
            NEXT_PUBLIC_IDENTITY_API_URL: 'http://localhost:4000',
            // A Clerk DEVELOPMENT key, coherent with the localhost endpoints above: src/config/env.ts asserts
            // the instance and endpoints belong to the same stage, so a pk_live here would (correctly) fail.
            // Decodes to `localhost$`.
            NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_bG9jYWxob3N0JA',
        },
    },
    resolve: {
        alias: {
            '@': srcPath,
            // The `/danger` subpath (the account danger-zone components) must be listed BEFORE the base
            // package alias so it wins the more-specific match.
            '@commise/features-account/danger': fileURLToPath(
                new URL('../features/account/src/danger/index.ts', import.meta.url),
            ),
            '@commise/features-account/testing': fileURLToPath(
                new URL('../features/account/src/__fixtures__/index.ts', import.meta.url),
            ),
            '@commise/features-account': fileURLToPath(new URL('../features/account/src/index.ts', import.meta.url)),
        },
    },
});
