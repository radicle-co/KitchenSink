import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

const srcPath = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
    plugins: [react()],
    test: {
        include: [
            'tests/**/*.test.ts',
            'tests/**/*.test.tsx',
            'src/**/__tests__/**/*.test.ts',
            'src/**/__tests__/**/*.test.tsx',
            'router/tests/**/*.test.ts',
            'infra/__tests__/**/*.test.ts',
            'scripts/__tests__/**/*.test.ts',
        ],
        environment: 'jsdom',
        setupFiles: ['./tests/setup.ts'],
        globals: true,
    },
    resolve: {
        alias: {
            '@': srcPath,
            // The `/danger` subpath (the account danger-zone components) must be listed BEFORE the base
            // package alias so it wins the more-specific match.
            '@commise/features-account/danger': fileURLToPath(
                new URL('../features/account/src/danger/index.ts', import.meta.url),
            ),
            '@commise/features-account': fileURLToPath(new URL('../features/account/src/index.ts', import.meta.url)),
        },
    },
});
