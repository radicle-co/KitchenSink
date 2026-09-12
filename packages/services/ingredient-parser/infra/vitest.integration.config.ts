import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
        // ⚠️ Serial. Both suites shell out to `python3`, and the packaging tier REWRITES `build/asset` in its
        // `beforeAll` — a parallel run would have one file reading the tree another is deleting.
        fileParallelism: false,
        typecheck: {
            enabled: false,
        },
        // The packaging tier runs a real `pip install` of ~90 MB of wheels over the network before the first
        // assertion. No assertion here measures a duration.
        testTimeout: 600_000,
        hookTimeout: 600_000,
    },
});
