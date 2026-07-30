import { defineConfig } from 'vitest/config';

/**
 * Unit tests for `@commise/i18n`. The core (locale config, matcher, dictionary) is platform-neutral and
 * runs under node; the React provider/hooks (`react.tsx`) are tested under jsdom via `@testing-library`.
 * jsdom is a superset environment for both, so one config covers the package.
 */
export default defineConfig({
    test: {
        globals: true,
        environment: 'jsdom',
        include: ['**/__tests__/**/*.test.{ts,tsx}'],
        exclude: ['node_modules', 'dist'],
    },
});
