import { defineConfig } from 'vitest/config';

/**
 * Integration tier: the suites that run the real graph over the real tree. Each builds the import graphs of both apps,
 * which takes several seconds, so the timeouts are generous and the models are built once per file.
 */
export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
        testTimeout: 120_000,
        hookTimeout: 120_000,
        typecheck: { enabled: false },
    },
});
