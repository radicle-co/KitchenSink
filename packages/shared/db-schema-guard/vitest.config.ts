import { baseConfig } from '@kitchensink/vitest';

/**
 * Unit tier. Merges `baseConfig` for the shared include glob and worktree exclusions. The scratch migration
 * directories this suite creates with `mkdtempSync` are removed by the suites themselves, in `afterAll`.
 */
export default {
    ...baseConfig,
    test: { ...baseConfig.test },
};
