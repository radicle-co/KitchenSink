import { testTempRootSetup } from '@kitchensink/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // ⛔ Confines this run's temp directories to one removable root — CDK's own `cdk.out*`
        // synth dirs and every `mkdtempSync(tmpdir())` fixture. Asserted by `vitestTempRoot.test.ts`.
        globalSetup: [testTempRootSetup],
        // `tests/e2e/auth.test.ts` drives the REAL `useAuth` hook through `renderHook`, which needs a DOM to
        // mount into. The suite still boots nothing and reaches nothing (`@clerk/expo` is mocked); jsdom is
        // only what lets the hook render at all.
        environment: 'jsdom',
        include: ['tests/e2e/**/*.test.ts'],
        exclude: ['node_modules', 'dist'],
        passWithNoTests: false,
    },
});
