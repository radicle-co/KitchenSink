import { baseConfig } from '@kitchensink/vitest';

/**
 * Unit tier. Merges `baseConfig` for its `globalSetup` temp-root confinement — this suite creates scratch
 * migration directories with `mkdtempSync`, which without the hook accumulate in the OS temp directory
 * forever (see `packages/tools/vitest/testTempRoot.js`).
 */
export default {
    ...baseConfig,
    test: { ...baseConfig.test },
};
