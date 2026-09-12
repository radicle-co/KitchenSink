import { defineConfig } from 'vitest/config';

// Integration tests run against a real Postgres (CI provides one as a service; locally, set
// DATABASE_URL). They share one database, so run serially to avoid cross-test interference.
export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
        // Provisions the role-split database once per run (ADR-0039) — the suites connect as identity_service.
        globalSetup: ['./tests/globalSetup.ts'],
        exclude: ['node_modules', 'dist'],
        typecheck: { enabled: false },
        testTimeout: 30_000,
        hookTimeout: 60_000,
        fileParallelism: false,
        passWithNoTests: true,
    },
});
