import { defineConfig } from 'vitest/config';

import { localE2eAwsPin } from '@kitchensink/service-test-harness/local-aws-pin';

/** The LOCAL e2e AWS pin (`@kitchensink/service-test-harness`'s `awsPin.ts`). */
const awsPin = localE2eAwsPin(process.env);

/**
 * LOCAL e2e config for `@kitchensink/recipe-workers` (`docs/CODING_STANDARDS.md` §7.1a): the worker handlers
 * against a real Postgres (provisioned by `tests/e2e/globalSetup.ts` under the production role model, ADR-0039,
 * and read as `recipe_app`) and a real LocalStack S3 and SQS (`S3_ENDPOINT`, `SQS_ENDPOINT`). The CRF suites also
 * need the Python engine installed (`packages/services/ingredient-parser/requirements.txt`).
 *
 * The suites share one S3 endpoint AND one database, so they run serially: one file's `truncate()` would empty
 * another's fixtures mid-test.
 */
export default defineConfig({
    test: {
        // The suites build their S3 and SQS clients from these two; an unset one would send a client to real AWS.
        env: { ...awsPin.env, S3_ENDPOINT: awsPin.endpoint, SQS_ENDPOINT: awsPin.endpoint },
        setupFiles: [...awsPin.setupFiles],
        include: ['tests/e2e/**/*.e2e.test.ts'],
        exclude: ['node_modules', 'dist'],
        globalSetup: ['./tests/e2e/globalSetup.ts'],
        typecheck: { enabled: false },
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 60_000,
        passWithNoTests: false,
    },
});
