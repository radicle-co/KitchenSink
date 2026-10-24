import { defineConfig } from 'vitest/config';

/**
 * Unit-test config. `tests/**` is the LOCAL e2e tier (`vitest.e2e.config.ts`), which needs a real PostgreSQL and
 * never skips, so the unit run reads `src/` only.
 */
export default defineConfig({
    test: {
        include: ['src/**/__tests__/**/*.test.ts'],
    },
});
