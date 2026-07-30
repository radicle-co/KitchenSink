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

        // `src/config/env.ts` validates the app's endpoints at MODULE LOAD and has no defaults, so any
        // test that transitively imports a service client would otherwise die with a configuration error.
        //
        // These are stated here rather than read from the committed `.env.development` because vitest runs
        // with NODE_ENV=test, and Next's own `.env.$(NODE_ENV)` loader — the thing that reads that file —
        // is not running. Next also deliberately skips `.env.development` under `test`. Declaring them
        // explicitly keeps the unit tier hermetic and matches how CI states the same two values for the
        // Playwright job.
        //
        // Values are irrelevant to assertions: every suite that touches the network intercepts it. What
        // matters is only that configuration is PRESENT, so a suite failing means the code is wrong rather
        // than the environment being unset. `src/config/__tests__/env.test.ts` overrides these per-case to
        // prove the missing/blank/relative paths still fail loudly.
        env: {
            NEXT_PUBLIC_RECIPE_API_URL: 'http://localhost:3000',
            NEXT_PUBLIC_IDENTITY_API_URL: 'http://localhost:4000',
        },
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
