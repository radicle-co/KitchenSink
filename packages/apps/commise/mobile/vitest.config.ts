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
        },
    },
});
