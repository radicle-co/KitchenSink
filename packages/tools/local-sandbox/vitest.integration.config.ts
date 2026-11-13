import { defineConfig } from 'vitest/config';

/**
 * Integration tier: a lane host wired to its session over a scripted shell. Nothing here reaches a Mac, a deployed
 * service or a database (`docs/CODING_STANDARDS.md` §7.1a), so it runs on CI's Linux runner.
 */
export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
        testTimeout: 120_000,
        hookTimeout: 120_000,
    },
});
