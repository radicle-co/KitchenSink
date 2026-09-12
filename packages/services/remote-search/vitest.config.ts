import { defineConfig } from 'vitest/config';

/**
 * The unit tier (with the load tier's pure planner), plus the wire-contract drift gates (`docs/CODING_STANDARDS.md` §15.2.5), which need no network and
 * run here so CI cannot forget them. The integration tier runs through `vitest.integration.config.ts`.
 */
export default defineConfig({
    test: {
        include: [
            'src/**/__tests__/**/*.test.ts',
            'tests/load/__tests__/**/*.test.ts',
            'contract/__tests__/**/*.test.ts',
        ],
        exclude: ['**/*.integration.test.ts', 'node_modules', 'dist'],
        typecheck: { enabled: false },
    },
});
