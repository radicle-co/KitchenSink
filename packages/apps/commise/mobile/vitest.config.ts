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
            '@commise/services-identity': '../../services/identity/src/index.ts',
            '@commise/services-identity/*': '../../services/identity/src/*',
        },
    },
});
