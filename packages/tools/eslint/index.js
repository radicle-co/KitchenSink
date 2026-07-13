import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import checkFile from 'eslint-plugin-check-file';

/**
 * Picks the file-naming regime for a package from its root directory (§1 of
 * docs/CODING_STANDARDS.md). The two regimes follow different ecosystem norms:
 *
 *  - `backend`  — NestJS/Lambda services under `packages/services/*`: kebab-case
 *                 `name.<role>.ts` for every file (§1a).
 *  - `frontend` — app/shared/client/util libraries under `packages/apps/*`,
 *                 `packages/shared/*`, `packages/clients/*`, `packages/utils/*`:
 *                 camelCase modules / PascalCase components & classes, NO hyphens (§1b).
 *  - `none`     — anything else (tooling configs, CDK infra apps): the filename
 *                 rule is not applied because §1 defines no convention for them.
 *
 * @param {string} rootDir - Absolute package root (the caller's `import.meta.dirname`).
 * @returns {'backend' | 'frontend' | 'none'}
 */
function namingRegimeForRoot(rootDir) {
    const normalized = String(rootDir).replaceAll('\\', '/');

    if (normalized.includes('/packages/services/')) {
        return 'backend';
    }

    const frontendSegments = ['/packages/apps/', '/packages/shared/', '/packages/clients/', '/packages/utils/'];

    if (frontendSegments.some((segment) => normalized.includes(segment))) {
        return 'frontend';
    }

    return 'none';
}

/**
 * Builds the `eslint-plugin-check-file` flat-config block that machine-enforces
 * the §1 file-naming convention for the given regime. Returns `[]` for the
 * `none` regime so callers can spread it unconditionally.
 *
 * The naming check runs with `ignoreMiddleExtensions: true`, so only the first
 * dot-delimited segment of a basename is validated — role/suffix tags
 * (`.service`, `.middleware`, `.integration`, `.test`, `.native`, `.spec`, `.config`)
 * and platform variants are transparently ignored.
 *
 * @param {'backend' | 'frontend' | 'none'} regime
 * @returns {import('eslint').Linter.Config[]}
 */
function filenameConventionConfig(regime) {
    if (regime === 'backend') {
        return [
            {
                files: ['**/*.{ts,tsx,js,jsx}'],
                ignores: [
                    // Drizzle migration artifacts are tool-generated and numbered/snake_case
                    // (e.g. `0005_identity_reset.*`) — they mirror generated SQL, not source we name.
                    '**/database/migrations/**',
                ],
                plugins: { 'check-file': checkFile },
                rules: {
                    // §1a — kebab-case name + dot-separated role suffix for EVERY file.
                    'check-file/filename-naming-convention': [
                        'error',
                        { '**/*.{ts,tsx,js,jsx}': 'KEBAB_CASE' },
                        { ignoreMiddleExtensions: true },
                    ],
                },
            },
        ];
    }

    if (regime === 'frontend') {
        return [
            {
                files: ['**/*.{ts,tsx,js,jsx}'],
                ignores: [
                    // Config files — `<tool>.config.*` (§1, both regimes).
                    '**/*.config.*',
                    // Next.js framework-mandated file names (§1b — allowed, not renameable).
                    '**/next-env.d.ts',
                    '**/{page,layout,route,not-found,global-error,template,loading,error,default,middleware,instrumentation,instrumentation-client,sitemap,robots,manifest,opengraph-image,twitter-image,icon,apple-icon}.{ts,tsx,js,jsx}',
                    // Expo Router route files — special prefixes/dynamic segments the router requires.
                    '**/_layout.{ts,tsx,js,jsx}',
                    '**/+*.{ts,tsx,js,jsx}',
                    '**/[[]*[]]*.{ts,tsx,js,jsx}',
                ],
                plugins: { 'check-file': checkFile },
                rules: {
                    // §1b — camelCase modules / PascalCase components & classes; NO hyphens.
                    // The custom glob accepts a leading letter (upper or lower) followed by
                    // alphanumerics only, which admits both camelCase and PascalCase while
                    // rejecting kebab-case and snake_case.
                    'check-file/filename-naming-convention': [
                        'error',
                        { '**/*.{ts,tsx,js,jsx}': '[a-zA-Z]*([a-zA-Z0-9])' },
                        { ignoreMiddleExtensions: true },
                    ],
                },
            },
        ];
    }

    return [];
}

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
 * 6. Machine-enforces the §1 file-naming convention via `eslint-plugin-check-file`, picking the
 *    backend (kebab) or frontend (camel/Pascal) regime from `tsconfigRootDir`.
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
        ...filenameConventionConfig(namingRegimeForRoot(tsconfigRootDir)),
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
                                // *declared* granular export barrels (database/*, types/*, hooks).
                                // Consumers such as the webhook Lambdas import those directly so they
                                // don't pull the whole package (e.g. the NestJS service) in via the top
                                // barrel; the `hooks` subpath likewise keeps React out of non-React
                                // consumers of a client package (e.g. `recipe-service-client/hooks`).
                                group: [
                                    '@kitchensink/*/*',
                                    '!@kitchensink/*/database',
                                    '!@kitchensink/*/database/*',
                                    '!@kitchensink/*/types',
                                    '!@kitchensink/*/types/*',
                                    '!@kitchensink/*/hooks',
                                ],
                                message:
                                    "Import a package's barrel '@kitchensink/<package>' or one of its declared subpath exports (database/*, types/*, hooks) — don't reach into other internals.",
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
