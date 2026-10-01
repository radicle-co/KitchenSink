import { defineConfig } from 'vitest/config';

/**
 * LOCAL e2e tier for the global infra package: the suites that drive the platform bootstrap against a real PostgreSQL
 * the job starts itself (`docs/CODING_STANDARDS.md` §7.1a). They never skip in CI: the job's last step runs
 * `.github/scripts/assertLocalTierRan.sh` over this run's report.
 *
 * `fileParallelism: false`: the suites create and drop roles on one server and serialize on the bootstrap's own
 * advisory lock, so running them side by side buys nothing and muddles a failure.
 */
export default defineConfig({
    test: {
        include: ['tests/e2e/**/*.e2e.test.ts'],
        fileParallelism: false,
        hookTimeout: 60_000,
        testTimeout: 60_000,
        typecheck: {
            enabled: false,
        },
    },
});
