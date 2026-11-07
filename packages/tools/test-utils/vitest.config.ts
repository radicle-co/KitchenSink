import { jsdomPolyfillsSetup } from '@kitchensink/vitest';
import { defineConfig } from 'vitest/config';

/**
 * Unit tests for `@commise/test-utils`. `renderWithProviders` composes RTL's `render` with the shared
 * `LocaleProvider`, so it must be exercised under jsdom.
 */
export default defineConfig({
    test: {
        globals: true,
        environment: 'jsdom',
        // jsdom implements neither AnimationEvent nor TransitionEvent — see jsdomPolyfills.js.
        setupFiles: [jsdomPolyfillsSetup],
        include: ['**/__tests__/**/*.test.{ts,tsx}'],
        // Native specs run under `vitest.native.config.ts`, which resolves the `.native` leaves.
        exclude: ['node_modules', 'dist', '**/*.native.test.tsx'],
    },
});
