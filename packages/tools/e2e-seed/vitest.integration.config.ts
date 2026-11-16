import { defineConfig } from 'vitest/config';

import { INTEGRATION_AWS_PIN } from '@kitchensink/service-test-harness/integration-aws-pin';

/**
 * Integration tier: the seeder's requests, over a REAL HTTP wire, validated by the REAL contract.
 *
 * A unit test that mocks `RecipeServiceClient` proves the seeder calls the mock correctly. It cannot tell
 * you that the body it builds satisfies `createRecipeRequestSchema` — the zod the service actually
 * validates with — or that the client can parse what comes back, or that paging terminates. Those live at
 * the boundary, so the test has to cross it.
 *
 * Self-contained, like the two client packages' tiers in the same CI job: a real in-process `node:http`
 * server, no Docker. What it CANNOT prove is that a DEPLOYED service accepts the request — only the
 * Maestro run itself does that, and it is the tier that would catch a contract the schema package and the
 * service had drifted apart on.
 */
export default defineConfig({
    test: {
        // The integration AWS pin (`@kitchensink/service-test-harness`'s `awsPin.ts`).
        env: { ...INTEGRATION_AWS_PIN.env },
        setupFiles: [...INTEGRATION_AWS_PIN.setupFiles],
        include: ['tests/**/*.integration.test.ts'],
        fileParallelism: false,
        testTimeout: 60_000,
        hookTimeout: 60_000,
    },
});
