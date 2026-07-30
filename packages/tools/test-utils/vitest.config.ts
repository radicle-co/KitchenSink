import { defineConfig } from 'vitest/config';

/**
 * Unit tests for `@commise/test-utils`. `renderWithProviders` composes RTL's `render` with the shared
 * `LocaleProvider`, so it must be exercised under jsdom.
 */
export default defineConfig({
    test: {
        globals: true,
        environment: 'jsdom',
        include: ['**/__tests__/**/*.test.{ts,tsx}'],
        exclude: ['node_modules', 'dist'],
    },
});
