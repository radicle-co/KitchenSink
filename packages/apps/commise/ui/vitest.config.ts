import { defineConfig } from 'vitest/config';

/**
 * Default (web) component-test config for the shared design-system components. Runs the `.tsx` web leaves
 * under jsdom. Native specs (`*.native.test.tsx`) are excluded here and owned by `vitest.native.config.ts`
 * (react-native-web); `npm test` runs both. `passWithNoTests` keeps the token-only files green.
 */
export default defineConfig({
    test: {
        globals: true,
        environment: 'jsdom',
        passWithNoTests: true,
        include: ['**/__tests__/**/*.test.{ts,tsx}'],
        exclude: ['node_modules', 'dist', '**/*.native.test.tsx'],
    },
});
