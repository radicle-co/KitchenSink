import { defineConfig } from 'vitest/config';

import { INTEGRATION_AWS_PIN } from '@kitchensink/service-test-harness/integration-aws-pin';

/**
 * Integration test config for `@kitchensink/recipe-service`: every dependency is MOCKED
 * (`docs/CODING_STANDARDS.md` §7.1a), so this tier opens no database and starts no LocalStack. A suite that needs
 * a real one is a LOCAL e2e suite (`vitest.e2e.config.ts`). Kept separate from the default unit run.
 *
 * Integration specs live in `**​/__tests__/integration/**​/*.integration.test.ts` (co-located under the
 * feature domain they cover, per the folder-by-domain convention).
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
        passWithNoTests: true,
    },
});
