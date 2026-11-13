import { baseConfig } from '@kitchensink/vitest';

/**
 * Default (unit) Vitest config for `@kitchensink/cooking-core`.
 *
 * The shared `baseConfig` includes only `**\/__tests__/**\/*.test.{ts,tsx}`. Without this file the
 * package would run on Vitest's own default glob, which also collects `tests/**\/*.integration.test.ts`. The
 * integration tier must stay out of the unit run (`docs/CODING_STANDARDS.md` §7).
 */
export default {
    ...baseConfig,
    test: {
        ...baseConfig.test,
    },
};
