import { defineConfig } from 'vitest/config';

/**
 * The DEPLOYED config (`docs/CODING_STANDARDS.md` §7.1a): every spec here drives services running in a real AWS stage
 * over the public internet. It holds two tiers as named projects, because they differ in what they may do to that
 * stage and must never be dragged into one another by a glob:
 *
 * - `boundary` (`tests/deployed/**`, `npm run test:deployed`) talks to `recipe-{stage}` / `food-{stage}` and never
 *   writes, because the same specs run against PRODUCTION, where the rows are real users' data. That is what makes it
 *   credential-free: everything it can assert without a Clerk token is asserted, and nothing else is attempted.
 * - `linkage` (`tests/e2e/**`, `npm run test:linkage`) drives a `pr-{N}` preview with the test pool's linkage
 *   credential (`scripts/mintLinkageCredentials.ts`) and may write to that preview. Its main proof — that
 *   recipe-service resolves an ingredient against a REAL food-service record and derives a recipe's nutrition from
 *   that live lookup — belongs to neither service, so it lives in neither service's suite. `deployedE2eTiers.yml`'s
 *   linkage job runs it one spec at a time, each with a freshly minted token.
 *
 * `fileParallelism: false` because the specs share one stage and one pool slot. Timeouts are generous: every
 * assertion is a real round trip through DNS, the shared ALB and a Fargate task.
 */
export default defineConfig({
    test: {
        fileParallelism: false,
        testTimeout: 60_000,
        hookTimeout: 120_000,
        typecheck: {
            enabled: false,
        },
        projects: [
            { extends: true, test: { name: 'boundary', include: ['tests/deployed/**/*.e2e.test.ts'] } },
            { extends: true, test: { name: 'linkage', include: ['tests/e2e/**/*.e2e.test.ts'] } },
        ],
    },
});
