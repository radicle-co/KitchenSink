import { baseConfig } from '@kitchensink/vitest';

/**
 * Default (unit) Vitest config for `@kitchensink/cooking-core`.
 *
 * The shared `baseConfig` includes only `**\/__tests__/**\/*.test.{ts,tsx}`. Without this file the
 * package ran on Vitest's own default glob, which would ALSO collect
 * `tests/**\/*.integration.test.ts` — the integration tier must stay out of the unit run (repo test
 * convention, `docs/CODING_STANDARDS.md` §7). Integration specs run under
 * `vitest.integration.config.ts` via `npm run test:integration`.
 */
export default {
    ...baseConfig,
    test: {
        ...baseConfig.test,
    },
};
