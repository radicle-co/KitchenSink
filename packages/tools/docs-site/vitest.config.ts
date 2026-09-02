import { testTempRootSetup } from '@kitchensink/vitest';
import { defineConfig } from 'vitest/config';

/**
 * Unit tier: the pure content-ingestion layer (registry, resolver, navbar/plugin derivation) plus the
 * on-disk guard that the declared sources actually reach files. No Docusaurus, no browser, no network.
 */
export default defineConfig({
    test: {
        // ⛔ Confines this run's temp directories to one removable root. Asserted by `vitestTempRoot.test.ts`.
        globalSetup: [testTempRootSetup],
        include: ['src/**/*.test.ts'],
        exclude: ['node_modules/**', 'build/**', '.docusaurus/**'],
    },
});
