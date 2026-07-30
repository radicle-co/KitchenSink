import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts', 'infra/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
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
