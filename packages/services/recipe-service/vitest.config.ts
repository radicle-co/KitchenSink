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
        include: ['src/**/*.test.ts', 'infra/__tests__/**/*.test.ts'],
        exclude: ['**/node_modules/**', '**/dist/**', 'tests/**', 'src/**/__tests__/integration/**'],
    },
});
