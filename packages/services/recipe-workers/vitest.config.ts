import { defineConfig, mergeConfig } from 'vitest/config';
import { baseConfig } from '@kitchensink/vitest';

/**
 * Default (unit) test config for `@kitchensink/recipe-workers`. Inherits the shared `__tests__/**​/*.test.ts`
 * glob, which deliberately excludes the `*.integration.spec.ts` specs — those need the LocalStack S3
 * harness and run via `vitest.integration.config.ts` (`npm run test:integration`).
 */
export default mergeConfig(
    baseConfig,
    defineConfig({
        test: {
            passWithNoTests: true,
        },
    }),
);
