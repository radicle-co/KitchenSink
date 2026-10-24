import { defineConfig } from 'vitest/config';

/**
 * Unit tier: the pure segmentation/extraction logic, and the deployed suite's own support modules. No network, no
 * filesystem beyond committed fixtures. The integration and deployed tiers have their own configs.
 */
export default defineConfig({
    test: {
        include: ['src/**/*.test.ts', 'tests/deployed/support/__tests__/**/*.test.ts'],
        exclude: ['**/*.integration.test.ts', '**/*.e2e.test.ts', 'node_modules/**'],
    },
});
