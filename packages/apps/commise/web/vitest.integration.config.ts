import { testTempRootSetup, jsdomPolyfillsSetup } from '@kitchensink/vitest';
/**
 * Vitest config for @commise/web's INTEGRATION tier.
 *
 * Separated from `vitest.config.ts` because Constitution Principle IV requires integration tests to run
 * via their own config and to stay out of the default `test` task. Before this file existed, the two
 * suites under `tests/__integration__/` matched the default `tests/**\/*.test.ts(x)` globs and ran inside
 * the unit tier — so a slow, real-compiler suite was gating every unit run and the tier boundary the
 * constitution mandates did not exist.
 *
 * These suites use a REAL adapter (the app's actual Tailwind compiler, the real analytics redaction path)
 * rather than a stub, which is what makes them integration tests — but they are self-contained and need no
 * Docker, LocalStack, or network. They run in CI via `npm run test:integration --workspace=@commise/web`.
 */
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
        include: ['tests/__integration__/**/*.integration.test.ts', 'tests/__integration__/**/*.integration.test.tsx'],
        exclude: ['node_modules', 'dist'],
        environment: 'jsdom',
        setupFiles: [jsdomPolyfillsSetup, './tests/setup.ts'],
        globals: true,

        // Compiling the real stylesheet is slower than a unit test; the default 5s timeout is too tight.
        testTimeout: 30_000,

        // Same rationale as the unit config: `src/config/env.ts` validates the app's endpoints at MODULE
        // LOAD with no defaults, so any suite that transitively imports a service client dies with a
        // configuration error unless these are present. Values are irrelevant to the assertions.
        env: {
            NEXT_PUBLIC_RECIPE_API_URL: 'http://localhost:3000',
            NEXT_PUBLIC_IDENTITY_API_URL: 'http://localhost:4000',
        },
    },
    resolve: {
        alias: {
            '@': srcPath,
            // The `/danger` subpath must be listed BEFORE the base package alias so it wins the more
            // specific match.
            '@commise/features-account/danger': fileURLToPath(
                new URL('../features/account/src/danger/index.ts', import.meta.url),
            ),
            '@commise/features-account': fileURLToPath(new URL('../features/account/src/index.ts', import.meta.url)),
        },
    },
});
