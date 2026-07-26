import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        setupFiles: [],
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*'],
            exclude: ['node_modules', 'dist'],
        },
    },
    resolve: {
        alias: {
            '@kitchensink/identity-service': '../../services/identity/src/index.ts',
            '@kitchensink/identity-service/*': '../../services/identity/src/*',
            '@commise/features-account': '../features/account/src/index.ts',
            // Resolve the shared numeric design scale to its source so the token drift guard runs without a
            // built `@commise/ui/dist` (mirrors the workspace-src aliasing used for the other packages above).
            '@commise/ui/scale': '../ui/src/tokens/scale.ts',
        },
    },
});
