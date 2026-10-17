import { defineConfig } from 'vitest/config';

import { localE2eAwsPin } from '@kitchensink/service-test-harness/local-aws-pin';

/** The LOCAL e2e AWS pin (`@kitchensink/service-test-harness`'s `awsPin.ts`). */
const awsPin = localE2eAwsPin(process.env);

/**
 * The LOCAL e2e tier (`docs/CODING_STANDARDS.md` §7.1a): the real handlers with their secrets in a real Secrets
 * Manager API (LocalStack, named by `AWS_ENDPOINT_URL`) and USDA as a loopback stand-in. It proves the search and
 * the signing key provisioner against the store they deploy with, never a deployment.
 *
 * `passWithNoTests: false`, and the suites refuse to run rather than skip without LocalStack, so a run that tested
 * nothing cannot report green.
 */
export default defineConfig({
    test: {
        env: { ...awsPin.env },
        setupFiles: [...awsPin.setupFiles],
        include: ['tests/e2e/**/*.e2e.test.ts'],
        exclude: ['node_modules', 'dist', 'dist-lambda'],
        typecheck: { enabled: false },
        passWithNoTests: false,
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 60_000,
    },
});
