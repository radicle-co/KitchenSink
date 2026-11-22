import { baseConfig } from '@kitchensink/vitest';

/**
 * Unit tier. `baseConfig`'s include glob is `**\/__tests__/**`, so the integration tier under `tests/` stays out of
 * this run and is wired to `vitest.integration.config.ts` (CODING_STANDARDS §7). Without a config of its own this
 * package would inherit vitest's default `**\/*.test.ts` glob and run both tiers as one, which §7 forbids.
 */
export default {
    ...baseConfig,
    test: { ...baseConfig.test },
};
