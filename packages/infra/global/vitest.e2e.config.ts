import { defineConfig } from 'vitest/config';

import { localE2eAwsPin } from '@kitchensink/service-test-harness/local-aws-pin';

/** The LOCAL e2e AWS pin (`@kitchensink/service-test-harness`'s `awsPin.ts`). */
const awsPin = localE2eAwsPin(process.env);

/**
 * LOCAL e2e tier for the global infra package: the suites that drive the platform bootstrap against a real PostgreSQL
 * on the developer's machine (`docs/CODING_STANDARDS.md` §7.1a). They never skip: with no `DATABASE_ADMIN_URL`,
 * `throwawayServerUrl` throws.
 *
 * `fileParallelism: false`: the suites create and drop roles on one server and serialize on the bootstrap's own
 * advisory lock, so running them side by side buys nothing and muddles a failure.
 */
export default defineConfig({
    test: {
        env: { ...awsPin.env },
        setupFiles: [...awsPin.setupFiles],
        include: ['tests/e2e/**/*.e2e.test.ts'],
        fileParallelism: false,
        hookTimeout: 60_000,
        testTimeout: 60_000,
        typecheck: {
            enabled: false,
        },
    },
});
