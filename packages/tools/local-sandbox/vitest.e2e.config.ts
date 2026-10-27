import { defineConfig } from 'vitest/config';

import { localE2eAwsPin } from '@kitchensink/service-test-harness/local-aws-pin';

/** The LOCAL e2e AWS pin (`@kitchensink/service-test-harness`'s `awsPin.ts`): every AWS client reaches LocalStack. */
const awsPin = localE2eAwsPin(process.env);

/**
 * LOCAL e2e config (`docs/CODING_STANDARDS.md` §7.1a): drives the sandbox `npm run local:up` started, on a developer's
 * machine. It never skips: a stack that is not up is a thrown error. No workflow runs it.
 */
export default defineConfig({
    test: {
        env: { ...awsPin.env },
        setupFiles: [...awsPin.setupFiles],
        include: ['tests/e2e/**/*.e2e.test.ts'],
        passWithNoTests: false,
        fileParallelism: false,
        hookTimeout: 120_000,
        testTimeout: 600_000,
    },
});
