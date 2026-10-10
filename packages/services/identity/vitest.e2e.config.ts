import { defineConfig } from 'vitest/config';

import { localE2eAwsPin } from '@kitchensink/service-test-harness/local-aws-pin';

/** The LOCAL e2e AWS pin (`@kitchensink/service-test-harness`'s `awsPin.ts`). */
const awsPin = localE2eAwsPin(process.env);

export default defineConfig({
    test: {
        env: { ...awsPin.env },
        setupFiles: [...awsPin.setupFiles],
        include: ['tests/e2e/**/*.test.ts'],
        // Provisions `identity_e2e_test` once per run; with no admin server it throws, so the tier never skips.
        globalSetup: ['./tests/e2e/globalSetup.ts'],
        typecheck: { enabled: false },
        passWithNoTests: false,
        // The real-database specs share that one database (bootServiceApp's strategy 2 contract).
        fileParallelism: false,
    },
});
