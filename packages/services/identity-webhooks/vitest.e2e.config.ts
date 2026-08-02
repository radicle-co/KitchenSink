import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        include: ['tests/e2e/**/*.e2e.test.ts'],
        exclude: ['node_modules', 'dist'],
        testTimeout: 30_000,
        hookTimeout: 30_000,
        passWithNoTests: false,
        pool: {
            forks: { execArgv: ['--enable-source-maps'] },
        },
    },
    resolve: {
        alias: { '@': path.resolve(process.cwd(), 'src') },
    },
});
