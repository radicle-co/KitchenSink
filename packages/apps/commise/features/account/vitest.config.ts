import { defineConfig } from 'vitest/config';

/**
 * Default (web) test config for `@commise/features-account`. Runs the pure-logic `*.test.ts` specs and the
 * web `.tsx` component leaves under jsdom. Native specs (`*.native.test.tsx`) are excluded here and owned by
 * `vitest.native.config.ts` (react-native-web); `npm test` runs both.
 */
export default defineConfig({
    test: {
        globals: true,
        environment: 'jsdom',
        include: ['**/__tests__/**/*.test.{ts,tsx}'],
        exclude: ['node_modules', 'dist', '**/*.native.test.tsx'],
    },
});
