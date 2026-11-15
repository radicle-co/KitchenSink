import { defineConfig } from 'vitest/config';

import { INTEGRATION_AWS_PIN } from '@kitchensink/service-test-harness/integration-aws-pin';

/**
 * Integration tier: a lane host wired to its session over a scripted shell. Nothing here reaches a Mac, a deployed
 * service or a database (`docs/CODING_STANDARDS.md` §7.1a), so it runs on CI's Linux runner.
 */
export default defineConfig({
    test: {
        // The integration AWS pin (`@kitchensink/service-test-harness`'s `awsPin.ts`).
        env: { ...INTEGRATION_AWS_PIN.env },
        setupFiles: [...INTEGRATION_AWS_PIN.setupFiles],
        include: ['tests/**/*.integration.test.ts'],
        testTimeout: 30_000,
        hookTimeout: 60_000,
    },
});
