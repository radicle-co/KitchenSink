import { defineConfig } from 'vitest/config';

import { baseConfig } from '@kitchensink/vitest';

/**
 * The INTEGRATION tier: it runs the real Tailwind compiler over the real component sources. Its own config, its own
 * `include` and its own script (`docs/CODING_STANDARDS.md` §7), so the default `test` glob never picks it up.
 *
 * ⛔ NOT `mergeConfig(baseConfig, …)`: `mergeConfig` concatenates array fields, so an `include` given here would be
 * appended to the base one and this tier would run the unit suite a second time. The base's other settings are spread
 * explicitly instead.
 */
export default defineConfig({
    ...baseConfig,
    test: {
        ...baseConfig.test,
        include: ['tests/**/*.integration.test.ts'],
        // Tailwind scans five source trees; cold, that is several seconds.
        testTimeout: 120_000,
        hookTimeout: 120_000,
    },
});
