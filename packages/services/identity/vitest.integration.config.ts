import { defineConfig } from 'vitest/config';

import { INTEGRATION_AWS_PIN } from '@kitchensink/service-test-harness/integration-aws-pin';

/**
 * Integration test config: every dependency is MOCKED (`docs/CODING_STANDARDS.md` §7.1a), so this tier opens no
 * database. A suite that needs a real one is a LOCAL e2e suite (`vitest.e2e.config.ts`).
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
        passWithNoTests: true,
    },
});
