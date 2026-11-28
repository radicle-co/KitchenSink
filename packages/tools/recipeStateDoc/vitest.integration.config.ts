import { defineConfig } from 'vitest/config';

/** Integration tier: the generator over the real document and the real module. */
export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
        typecheck: { enabled: false },
    },
});
