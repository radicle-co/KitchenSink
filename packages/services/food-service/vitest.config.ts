import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/__tests__/**/*.test.ts', 'tests/**/*.test.ts', 'infra/__tests__/**/*.test.ts'],
        exclude: ['tests/e2e/**', '**/*.integration.test.ts', 'node_modules', 'dist'],
        typecheck: {
            enabled: false,
        },
    },
});
