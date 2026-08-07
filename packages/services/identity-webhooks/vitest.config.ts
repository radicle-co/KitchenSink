import { defineConfig, mergeConfig } from 'vitest/config';
import { baseConfig } from '@kitchensink/vitest';

/**
 * Unit-test config. The shared `baseConfig` include (`**​/__tests__/**​/*.test.{ts,tsx}`) already cannot
 * match the non-unit tiers, which live under `tests/` — but `tests/**` is excluded EXPLICITLY so the
 * separation is stated rather than inferred from a glob coincidence: the integration tier
 * (`tests/**​/*.integration.test.ts`, `vitest.integration.config.ts`) and the e2e tier
 * (`tests/e2e/**​/*.e2e.test.ts`, `vitest.e2e.config.ts`) each own their config, and both need a real
 * Postgres/AWS harness a plain `npm run test` must never require. Per CODING_STANDARDS §7.1, `npm run test`
 * is unit-only.
 */
export default mergeConfig(
    baseConfig,
    defineConfig({
        test: {
            exclude: ['tests/**'],
            passWithNoTests: true,
        },
    }),
);
