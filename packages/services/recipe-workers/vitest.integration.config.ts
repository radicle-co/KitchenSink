import { defineConfig } from 'vitest/config';

import { INTEGRATION_AWS_PIN } from '@kitchensink/service-test-harness/integration-aws-pin';

/**
 * Integration test config for `@kitchensink/recipe-workers`: every dependency is MOCKED
 * (`docs/CODING_STANDARDS.md` §7.1a), so this tier opens no database and starts no LocalStack. The suites that
 * need a real one are LOCAL e2e (`vitest.e2e.config.ts`).
 */
export default defineConfig({
    test: {
        // The integration AWS pin (`@kitchensink/service-test-harness`'s `awsPin.ts`).
        env: { ...INTEGRATION_AWS_PIN.env },
        setupFiles: [...INTEGRATION_AWS_PIN.setupFiles],
        include: ['**/__tests__/integration/**/*.integration.test.ts'],
        exclude: ['node_modules', 'dist'],
        typecheck: { enabled: false },
        testTimeout: 30_000,
        hookTimeout: 60_000,
        passWithNoTests: false,
    },
});
