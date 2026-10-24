import { defineConfig } from 'vitest/config';

import { INTEGRATION_AWS_PIN } from '@kitchensink/service-test-harness/integration-aws-pin';

/**
 * Integration tier: the suites that run real processes (shell scripts against stubbed CLIs, local servers), kept out of
 * the unit run so they never share a process pool with tests that read what they write.
 *
 * `fileParallelism: false` because several suites stub the same CLIs on `PATH` and write into shared scratch
 * directories. Timeouts are generous because the work is real.
 */
export default defineConfig({
    test: {
        // The integration AWS pin (`@kitchensink/service-test-harness`'s `awsPin.ts`).
        env: { ...INTEGRATION_AWS_PIN.env },
        setupFiles: [...INTEGRATION_AWS_PIN.setupFiles],
        include: ['tests/**/*.integration.test.ts'],
        fileParallelism: false,
        hookTimeout: 600_000,
        testTimeout: 120_000,
        typecheck: {
            enabled: false,
        },
    },
});
