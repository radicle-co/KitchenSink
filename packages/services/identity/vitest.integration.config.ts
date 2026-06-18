import { defineConfig } from 'vitest/config';

// Integration tests run against a real Postgres (CI provides one as a service; locally, set
// DATABASE_URL). They share one database, so run serially to avoid cross-test interference.
export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
        exclude: ['node_modules', 'dist'],
        typecheck: { enabled: false },
        testTimeout: 30_000,
        hookTimeout: 60_000,
        fileParallelism: false,
        passWithNoTests: true,
    },
});
