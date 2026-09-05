import { testTempRootSetup } from '@kitchensink/vitest';
import { defineConfig } from 'vitest/config';

/**
 * The DEPLOYED tier: specs that drive services running in a real AWS stage over the public internet.
 *
 * It is a tier of its own, beside `vitest.e2e.config.ts`, because the two prove different things against
 * different substrates and must never be dragged into one another by a glob. The LINKAGE tier
 * (`tests/e2e/**`) boots both services on the runner against a throwaway RSA key it mints itself, and is
 * free to CREATE recipes; this tier talks to `recipe-{stage}` / `food-{stage}` and may never write, because
 * the same specs run against PRODUCTION, where the rows are real users' data.
 *
 * That constraint is what makes this tier credential-free: everything it can assert without a Clerk token
 * is asserted, and nothing else is attempted. See the spec's own header for what that buys and what it
 * leaves open.
 *
 * `fileParallelism: false` and generous timeouts: every assertion is a real round trip over the public
 * internet through DNS, the shared ALB and a Fargate task.
 */
export default defineConfig({
    test: {
        // ⛔ Confines this run's temp directories to one removable root — asserted by `vitestTempRoot.test.ts`.
        globalSetup: [testTempRootSetup],
        include: ['tests/deployed/**/*.e2e.test.ts'],
        fileParallelism: false,
        testTimeout: 60_000,
        hookTimeout: 120_000,
        typecheck: {
            enabled: false,
        },
    },
});
