import { defineConfig } from 'vitest/config';

/** Integration tier: the command over real files, and the pruner over every tracked board. */
export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
        // The corpus cases parse every tracked board, about 3,500 of them.
        testTimeout: 120_000,
        typecheck: { enabled: false },
    },
});
