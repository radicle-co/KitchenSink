import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import checkFile from 'eslint-plugin-check-file';
import importX from 'eslint-plugin-import-x';

import { nativeA11yPlugin } from './nativeA11y.js';

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
 * §14.2: an APP may import only *types* from a deployable service package. A value import drags the
 * service's runtime — NestJS, Drizzle, `pg` — into a browser or React Native bundle, and worse, couples
 * a client to server internals that are free to change without a wire-contract change.
 *
 * Uses the `@typescript-eslint` variant rather than the base rule because only it understands
 * `allowTypeImports`; the base rule cannot tell `import type` from `import`, so it could only ban the
 * specifier outright and there are six legitimate type imports today.
 *
 * Applied only to app packages, detected from the package root the caller passes — the services
 * themselves and the shared libraries import each other's runtimes legitimately. Measured at ZERO
 * violations before enabling (all six existing app→service imports are `import type` or `export type`),
 * so it lands as a pure ratchet with no baseline.
 *
 * @param {string} rootDir - Absolute package root (the caller's `import.meta.dirname`).
 * @returns {import('eslint').Linter.Config[]}
 */
function appServiceTypeOnlyConfig(rootDir) {
    if (!String(rootDir).replaceAll('\\', '/').includes('/packages/apps/')) {
        return [];
    }

    return [
        {
            files: ['**/*.{ts,tsx}'],
            rules: {
                '@typescript-eslint/no-restricted-imports': [
                    'error',
                    {
                        patterns: [
                            {
                                group: ['@kitchensink/*-service', '@kitchensink/*-service/**'],
                                allowTypeImports: true,
                                message:
                                    'An app may import only TYPES from a deployable service (§14.2). A value ' +
                                    'import pulls the service runtime (NestJS/Drizzle/pg) into the client ' +
                                    'bundle. Use `import type`, or go through the service CLIENT package.',
                            },
                        ],
                    },
                ],
            },
        },
    ];
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
            // Web/native accessibility PARITY (#123). `accessibilityState` reaches no DOM attribute on
            // react-native-web, so any key of it that lacks a projecting sibling prop is announced on device and
            // silent on the web build. Applied to every JSX file rather than only `*.native.tsx`: the prop is
            // meaningless outside React Native, so the false-positive surface elsewhere is nil, and scoping it
            // by filename would miss shared `.tsx` leaves and mobile screens that carry it. See
            // `nativeA11y.js` for why this is hand-rolled (no published plugin covers it — the obvious
            // candidate closed the request as `not_planned` and peer-caps at ESLint 8).
            files: ['**/*.{tsx,jsx}'],
            plugins: { 'native-a11y': nativeA11yPlugin },
            rules: {
                'native-a11y/accessibility-state-needs-aria-sibling': 'error',
            },
        },
        {
            // §4: a relative path may never leave its own workspace. `eslint-plugin-import-x` was already
            // installed and a declared peer dependency here, but was never REGISTERED — so the rule that
            // encodes the convention has been shipping as prose only.
            //
            // This is the AST-level half of a pair: `turbo boundaries` (see scripts/boundariesRatchet.mjs)
            // catches a bare specifier that the manifest does not declare, and this catches the other
            // evasion — reaching into a sibling package by relative path, which needs no declaration at
            // all and therefore slips past the manifest check entirely. Neither rule sees what the other
            // sees.
            //
            // Measured at ZERO violations across the tree before being enabled, so it lands as a pure
            // ratchet with no baseline. (A grep for `../../../` is NOT how you measure this: 215 such
            // imports exist and every one is intra-package, which the rule correctly permits — it flags
            // only relative paths that resolve into a DIFFERENT package.)
            plugins: { 'import-x': importX },
            settings: {
                // WITHOUT a resolver the rule is a NO-OP: import-x cannot map the specifier to a target
                // package.json, so it bails silently and every violation passes. Verified by mutation —
                // a genuine cross-package relative import produced zero output until this was added.
                // `createNodeResolver` ships inside import-x v4, so this needs no extra dependency.
                'import-x/resolver-next': [
                    importX.createNodeResolver({
                        extensionAlias: { '.js': ['.ts', '.tsx', '.js'], '.jsx': ['.tsx', '.jsx'] },
                        extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
                    }),
                ],
            },
            rules: {
                'import-x/no-relative-packages': 'error',
            },
        },
        ...appServiceTypeOnlyConfig(tsconfigRootDir),
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
                                // *declared* granular export barrels (database/*, types/*, hooks, testing,
                                // users/handle-sync-publisher). Consumers such as the webhook Lambdas import
                                // those directly so they don't pull the whole package (e.g. the NestJS
                                // service) in via the top barrel; the `hooks` subpath likewise keeps React
                                // out of non-React consumers of a client package (e.g.
                                // `recipe-service-client/hooks`); the `testing` subpath is the declared home
                                // for a package's shared Object Mother fixtures (e.g. `recipe-core/testing`,
                                // T1) so downstream tests import fixtures without pulling the runtime
                                // barrel's full surface; `users/handle-sync-publisher` is identity-service's
                                // declared export for the SNS handle-sync publisher that identity-webhooks
                                // consumes to publish rename events (W8-a.2).
                                // `ignore` (gitignore semantics) refuses to un-ignore a deep path whose
                                // enclosing directory is still ignored, so `users/handle-sync-publisher`
                                // needs the 3-line un-ignore/re-ignore/un-ignore dance below rather than a
                                // single negation like the shallower subpaths above.
                                group: [
                                    '@kitchensink/*/*',
                                    '!@kitchensink/*/database',
                                    '!@kitchensink/*/database/*',
                                    '!@kitchensink/*/types',
                                    '!@kitchensink/*/types/*',
                                    '!@kitchensink/*/hooks',
                                    '!@kitchensink/*/testing',
                                    '!@kitchensink/*/users',
                                    '@kitchensink/*/users/*',
                                    '!@kitchensink/*/users/handle-sync-publisher',
                                ],
                                message:
                                    "Import a package's barrel '@kitchensink/<package>' or one of its declared subpath exports (database/*, types/*, hooks, testing, users/handle-sync-publisher) — don't reach into other internals.",
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
                    {
                        // CODING_STANDARDS: environment variables are read with BRACKET notation. The rule was
                        // prose only, so it drifted — 47 dot-access sites had accumulated across tests, CDK
                        // entry points and config modules with nothing to catch them.
                        //
                        // Worth enforcing rather than relaxing: under TypeScript's
                        // `noPropertyAccessFromIndexSignature`, `process.env.FOO` is a type error while
                        // `process.env['FOO']` is not, so bracket access is what keeps the index-signature
                        // discipline honest — and it makes every environment read greppable as ONE shape,
                        // which matters for a repo whose worst outages have all been misconfiguration.
                        //
                        // The one real exception (bundler inlining in a frontend `runtimeEnv` map) is granted
                        // by PATH in the final config object below, not by an inline disable.
                        selector:
                            "MemberExpression[computed=false][object.type='MemberExpression'][object.object.name='process'][object.property.name='env']",
                        message:
                            "Read environment variables with bracket notation: process.env['KEY'], not process.env.KEY (CODING_STANDARDS). The sole exception is a bundler-inlined `runtimeEnv` map in a frontend src/config/env.ts, allowed by path in the shared ESLint config.",
                    },
                ],
            },
        },
        {
            /**
             * The ONE exception to bracket-notation environment reads, granted by path so it stays visible and
             * bounded instead of being disabled inline at each site.
             *
             * Next and Metro inline `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*` at BUILD time by substituting a literal
             * `process.env.X` member expression. A computed lookup (`process.env['X']`) is NOT substituted, so
             * bracket notation in these `runtimeEnv` maps compiles to `undefined` in the browser — the variable
             * silently vanishes from the shipped bundle. That is the very silent-misconfiguration class these
             * modules exist to prevent, so here the convention yields to the bundler.
             *
             * Scoped to the config modules themselves. Everywhere else in the frontend packages — components,
             * hooks, tests, scripts — the rule still applies, because nothing else is read through inlining.
             *
             * ⚠️ MUST remain the LAST object in this array. Flat config resolves later matching objects over
             * earlier ones, so an exception placed above the object that defines the rule is silently
             * overridden. That happened on the first attempt here, and an automated fix then rewrote these
             * exact files and broke inlining — caught only by reading the diff.
             */
            files: ['**/src/config/env.ts'],
            rules: {
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
