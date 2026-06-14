import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Creates the base ESLint configuration for KitchenSink packages.
 *
 * Returns an array of ESLint flat config objects that:
 * 1. Ignores build artifacts (dist/), dependencies (node_modules/), and config files
 * 2. Applies ESLint recommended rules for JavaScript
 * 3. Applies typescript-eslint recommended rules for TypeScript type checking
 * 4. Configures the TypeScript parser with project-based type information:
 *    - Uses tsconfigPath to locate the project's tsconfig.json
 *    - Uses tsconfigRootDir for resolving relative paths in tsconfig
 *    - Enforces strict rules: no unused variables (ignoring _ prefixed), always use braces, padding between statements
 * 5. Relaxes rules for test files (__tests__/**\/*.ts, \*.test.ts) to allow 'any' types and non-null assertions
 *
 * Platform-agnostic (no node/browser globals) for code that runs on web, node, and react native.
 *
 * @param {string} tsconfigPath - Path to the tsconfig.json file (defaults to './tsconfig.json')
 * @param {string} [tsconfigRootDir] - Root directory for tsconfig resolution (defaults to process.cwd())
 * @returns {import('eslint').Linter.Config[]} ESLint configuration array (flat config format for ESLint 9+)
 */
export function createConfig(tsconfigPath = './tsconfig.json', tsconfigRootDir = process.cwd()) {
    return [
        {
            ignores: ['dist/**', 'node_modules/**', '*.config.js', '*.config.ts', '**/*.mjs'],
        },
        eslint.configs.recommended,
        ...tseslint.configs.recommended,
        {
            languageOptions: {
                parserOptions: {
                    project: tsconfigPath,
                    tsconfigRootDir: tsconfigRootDir,
                },
            },
            rules: {
                '@typescript-eslint/no-unused-vars': [
                    'error',
                    {
                        argsIgnorePattern: '^_',
                        varsIgnorePattern: '^_',
                    },
                ],
                curly: ['error', 'all'],
                'padding-line-between-statements': [
                    'error',
                    { blankLine: 'always', prev: 'block-like', next: '*' },
                    { blankLine: 'always', prev: '*', next: 'block-like' },
                    { blankLine: 'always', prev: '*', next: 'return' },
                    { blankLine: 'always', prev: '*', next: 'function' },
                    { blankLine: 'always', prev: 'function', next: '*' },
                ],
            },
        },
        {
            files: ['**/__tests__/**/*.ts', '**/*.test.ts'],
            rules: {
                '@typescript-eslint/no-explicit-any': 'off',
                '@typescript-eslint/no-non-null-assertion': 'off',
            },
        },
        {
            rules: {
                'no-restricted-imports': [
                    'error',
                    {
                        patterns: [
                            {
                                // Block reaching into another package's internals, but allow its
                                // *declared* granular export barrels (database/*, types/*). Consumers
                                // such as the webhook Lambdas import those directly so they don't pull
                                // the whole package (e.g. the NestJS service) in via the top barrel.
                                group: [
                                    '@kitchensink/*/*',
                                    '!@kitchensink/*/database',
                                    '!@kitchensink/*/database/*',
                                    '!@kitchensink/*/types',
                                    '!@kitchensink/*/types/*',
                                ],
                                message:
                                    "Import a package's barrel '@kitchensink/<package>' or one of its declared subpath exports (database/*, types/*) — don't reach into other internals.",
                            },
                        ],
                    },
                ],
                'no-restricted-syntax': [
                    'error',
                    {
                        selector: 'ImportDeclaration[source.value=/\\.tsx?$/]',
                        message:
                            'Do not use .ts or .tsx extensions in import paths. Use .js or .jsx extensions instead.',
                    },
                ],
            },
        },
    ];
}

export default createConfig;
