import { defineConfig } from 'vitest/config';

/**
 * `RuleTester` coverage for this package's custom ESLint rules. Node environment: the rules are pure AST
 * analysis, so there is no DOM to stand up.
 */
export default defineConfig({
    test: {
        environment: 'node',
        include: ['__tests__/**/*.test.js'],
        exclude: ['node_modules'],
    },
});
