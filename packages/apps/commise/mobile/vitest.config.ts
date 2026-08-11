import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        setupFiles: [],
        include: ['tests/**/*.test.ts'],

        // `src/config/env.ts` validates the app's endpoints at MODULE LOAD and has no defaults, so any
        // screen test that reaches a service client would otherwise die with a configuration error.
        // Expo's own `.env.development` loader is not running under vitest, so state them explicitly —
        // the same reason and the same two values the web app's vitest config uses.
        //
        // Values are irrelevant to assertions (these suites never hit the network); only PRESENCE matters,
        // so a red test means the code is wrong rather than the environment being unset.
        // `tests/config/env.test.ts` overrides them per-case to prove absence still fails loudly.
        env: {
            EXPO_PUBLIC_RECIPE_API_URL: 'http://localhost:3000',
            EXPO_PUBLIC_IDENTITY_API_URL: 'http://localhost:4000',
        },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*'],
            exclude: ['node_modules', 'dist'],
        },
    },
    resolve: {
        alias: {
            '@kitchensink/schema-identity': '../../schemas/identity/src/index.ts',
            '@commise/features-account': '../features/account/src/index.ts',
            // Resolve the shared numeric design scale to its source so the token drift guard runs without a
            // built `@commise/ui/dist` (mirrors the workspace-src aliasing used for the other packages above).
            '@commise/ui/scale': '../ui/src/tokens/scale.ts',
        },
    },
});
