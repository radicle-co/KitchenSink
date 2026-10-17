import { createConfig } from '@kitchensink/eslint';

const base = createConfig('./tsconfig.json', import.meta.dirname);

export default [
    ...base,
    {
        /**
         * Granted by PATH so it stays visible and bounded rather than disabled at each call site.
         *
         * Several guards unit-test a pure function exported by a repo-root `scripts/*.mjs` module by importing it,
         * which is the only way to assert on a decision function rather than on a subprocess's stdout.
         * `import-x/no-relative-packages` reports each one, and its suggested remedy does not exist: `kitchensink` is
         * the private workspace ROOT, which npm never links into `node_modules` and which publishes no `exports` map.
         * The rule's real target, a sibling WORKSPACE reached through `../../`, is unaffected: repo-root `scripts/` is
         * not a workspace. Giving those scripts a workspace of their own would delete this block.
         */
        files: ['__tests__/**/*.ts', 'tests/**/*.ts'],
        rules: {
            'import-x/no-relative-packages': 'off',
        },
    },
];
