import { defineConfig } from 'vitest/config';

/** Unit tier: the pure segmentation/extraction logic. No network, no filesystem beyond committed fixtures. */
export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        exclude: ['tests/**', 'node_modules/**'],
    },
});
