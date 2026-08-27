import { testTempRootSetup } from '@kitchensink/vitest';
import { defineConfig } from 'vitest/config';

/**
 * Default (web) test config for `@commise/features-account`. Runs the pure-logic `*.test.ts` specs and the
 * web `.tsx` component leaves under jsdom. Native specs (`*.native.test.tsx`) are excluded here and owned by
 * `vitest.native.config.ts` (react-native-web); `npm test` runs both.
 */
export default defineConfig({
    test: {
        // ⛔ Confines this run's temp directories to one removable root — CDK's own `cdk.out*`
        // synth dirs and every `mkdtempSync(tmpdir())` fixture. Asserted by `vitestTempRoot.test.ts`.
        globalSetup: [testTempRootSetup],
        globals: true,
        environment: 'jsdom',
        include: ['**/__tests__/**/*.test.{ts,tsx}'],
        exclude: ['node_modules', 'dist', '**/*.native.test.tsx'],
    },
});
