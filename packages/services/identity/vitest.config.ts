import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: [
            'tests/**/*.test.ts',
            'infra/__tests__/**/*.test.ts',
            'src/**/__tests__/**/*.test.ts',
            // The wire-contract drift gates (CODING_STANDARDS §15.2.5). Run in the DEFAULT tier on purpose:
            // they need no database and no network, and a gate that lives in its own tier is a gate someone
            // has to remember to add to CI.
            'contract/__tests__/**/*.test.ts',
        ],
        exclude: ['tests/e2e/**', '**/*.integration.test.ts', 'node_modules', 'dist'],
        typecheck: {
            enabled: false,
        },
        // The DB-mocked setup hooks and CDK infra synth tests run fast locally but intermittently exceed
        // the 5s test / 10s hook defaults under the parallel turbo test load on CI runners. Give realistic
        // headroom so a slow-but-correct run is never a false timeout failure.
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
});
