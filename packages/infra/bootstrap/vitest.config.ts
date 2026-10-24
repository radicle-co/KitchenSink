import { baseConfig } from '@kitchensink/vitest';

/**
 * Unit tier. Merges `baseConfig` for the shared `__tests__` include glob, which keeps the integration suites under
 * `tests/` out of the default `test` task (CODING_STANDARDS §7).
 */
export default {
    ...baseConfig,
    test: { ...baseConfig.test },
};
