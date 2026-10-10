import { defineConfig } from 'vitest/config';

/**
 * The DEPLOYED tier (`docs/CODING_STANDARDS.md` §7.1a): the specs that drive one pull request's remote search copy
 * over the public internet, through its real CloudFront distribution, with the signing key that stage published.
 *
 * Its own tier, beside `vitest.e2e.config.ts` (LOCAL: the handlers against LocalStack), because the two prove
 * different things against different substrates. A target is the caller's decision: `deployedE2eTiers.yml` runs this
 * only when the preview is up, so a missing target here is a failure, never a skip.
 */
export default defineConfig({
    test: {
        include: ['tests/deployed/**/*.e2e.test.ts'],
        fileParallelism: false,
        testTimeout: 60_000,
        hookTimeout: 60_000,
        typecheck: { enabled: false },
    },
});
