import { testTempRootSetup, jsdomPolyfillsSetup } from '@kitchensink/vitest';
import { defineConfig } from 'vitest/config';

/**
 * Unit tests for `@commise/test-utils`. `renderWithProviders` composes RTL's `render` with the shared
 * `LocaleProvider`, so it must be exercised under jsdom.
 */
export default defineConfig({
    test: {
        // ⛔ Confines this run's temp directories to one removable root — CDK's own `cdk.out*`
        // synth dirs and every `mkdtempSync(tmpdir())` fixture. Asserted by `vitestTempRoot.test.ts`.
        globalSetup: [testTempRootSetup],
        globals: true,
        environment: 'jsdom',
        // jsdom implements neither AnimationEvent nor TransitionEvent — see jsdomPolyfills.js.
        setupFiles: [jsdomPolyfillsSetup],
        include: ['**/__tests__/**/*.test.{ts,tsx}'],
        exclude: ['node_modules', 'dist'],
    },
});
