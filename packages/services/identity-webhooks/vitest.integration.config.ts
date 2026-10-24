import { defineConfig } from 'vitest/config';

import { INTEGRATION_AWS_PIN } from '@kitchensink/service-test-harness/integration-aws-pin';

/**
 * Integration-test config for `@kitchensink/identity-webhooks`: the Lambda handlers over MOCKED AWS SDK clients
 * and a mocked `pg` pool (`docs/CODING_STANDARDS.md` §7.1a). This tier opens no database. The erasure seams'
 * real-Postgres suites are LOCAL e2e (`vitest.e2e.config.ts`).
 */
export default defineConfig({
    test: {
        // The integration AWS pin (`@kitchensink/service-test-harness`'s `awsPin.ts`).
        env: { ...INTEGRATION_AWS_PIN.env },
        setupFiles: [...INTEGRATION_AWS_PIN.setupFiles],
        include: ['tests/**/*.integration.test.ts'],
        testTimeout: 30_000,
        hookTimeout: 60_000,
        exclude: ['node_modules', 'dist'],
        typecheck: { enabled: false },
        passWithNoTests: false,
    },
});
