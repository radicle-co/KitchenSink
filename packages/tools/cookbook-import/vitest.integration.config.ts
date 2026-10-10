import { defineConfig } from 'vitest/config';

import { INTEGRATION_AWS_PIN } from '@kitchensink/service-test-harness/integration-aws-pin';

/**
 * Integration tier: the import pipeline's parts wired together. No suite here reaches a deployed service or a
 * database (`docs/CODING_STANDARDS.md` §7.1a): the recipe and food services are in-process stand-ins, and the CRF
 * suites run the local engine `_ci.yml` installs. The suite that drives a real recipe and food service is
 * DEPLOYED-tier, in `vitest.deployed.config.ts`.
 */
export default defineConfig({
    test: {
        // The integration AWS pin (`@kitchensink/service-test-harness`'s `awsPin.ts`).
        env: { ...INTEGRATION_AWS_PIN.env },
        setupFiles: [...INTEGRATION_AWS_PIN.setupFiles],
        include: ['tests/**/*.integration.test.ts'],
        fileParallelism: false,
        testTimeout: 120_000,
        hookTimeout: 120_000,
    },
});
