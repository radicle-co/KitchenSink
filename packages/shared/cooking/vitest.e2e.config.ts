import { defineConfig } from 'vitest/config';

/**
 * LOCAL e2e tier for `@kitchensink/cooking-core`: the facts sheet built with the real duration reader over the
 * developer's own recipe corpus, which never enters the repository. It runs only on a developer's machine, through
 * `npm run test:e2e`, and throws when the corpus is missing, so it never skips.
 */
export default defineConfig({
    test: {
        include: ['tests/e2e/**/*.e2e.test.ts'],
        typecheck: { enabled: false },
        passWithNoTests: false,
    },
});
