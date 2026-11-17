import { defineConfig } from 'vitest/config';

import nativeConfig from './vitest.native.config.js';

/**
 * Integration test config for `@commise/features-cooking` (native lane). It is `vitest.native.config.ts` with one
 * change: it runs `tests/__integration__/*.native.integration.test.tsx`. The spread keeps the plugins, setup files and
 * aliases of the native lane in one place; `mergeConfig` is not used because it concatenates `include` arrays, so both
 * lists would run.
 */
export default defineConfig({
    ...nativeConfig,
    test: {
        ...nativeConfig.test,
        include: ['tests/__integration__/**/*.native.integration.test.tsx'],
    },
});
