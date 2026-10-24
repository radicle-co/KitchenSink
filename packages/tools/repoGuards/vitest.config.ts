import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['__tests__/**/*.test.ts'],
        // `tests/**` holds the integration, e2e and deployed tiers, each with its own config. Excluded by path AND by
        // suffix, so a `*.integration.test.ts` left in `__tests__/` cannot rejoin the unit run.
        exclude: ['tests/**', '**/*.integration.test.ts', 'node_modules', 'dist'],
        typecheck: {
            enabled: false,
        },
        // Several guards build a TypeScript program or walk the whole repository. That is fast locally and slow on a
        // loaded CI runner, so a correct guard must not fail on vitest's 5 s default.
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
});
