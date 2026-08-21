import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import checkFile from 'eslint-plugin-check-file';
import importX from 'eslint-plugin-import-x';

import { nativeA11yPlugin } from './nativeA11y.js';

/**
 * Picks the file-naming regime for a package from its root directory (§1 of
 * docs/CODING_STANDARDS.md). There is exactly ONE regime, applied to every package:
 *
 *  - `standard` — camelCase modules; PascalCase for a file whose subject is a class or a React
 *                 component. **Hyphens are prohibited in file names**, everywhere, without exception
 *                 beyond the framework-mandated names listed in the ignore globs below.
 *  - `none`     — paths outside `packages/` only.
 *
 * ⛔ **Do NOT reintroduce a per-package regime.** A prior revision applied `KEBAB_CASE` to
 * `packages/services/*` on the grounds that it was "framework-idiomatic" for NestJS. That is the
 * failure this comment exists to prevent: the linter, `CODING_STANDARDS §1a`, and every audit run
 * against them were mutually consistent and all wrong, so 505 hyphenated files read as COMPLIANT and
 * no check could ever surface them. NestJS does not require kebab file names — it resolves modules
 * through imports, not filenames. One regime, no ecosystem carve-outs.
 *
 * @param {string} rootDir - Absolute package root (the caller's `import.meta.dirname`).
 * @returns {'standard' | 'none'}
 */
function namingRegimeForRoot(rootDir) {
    const normalized = String(rootDir).replaceAll('\\', '/');

    return normalized.includes('/packages/') ? 'standard' : 'none';
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
 * @param {'standard' | 'none'} regime
 * @returns {import('eslint').Linter.Config[]}
 */
function filenameConventionConfig(regime) {
    if (regime !== 'standard') {
        return [];
    }

    return [
        {
            files: ['**/*.{ts,tsx,js,jsx}'],
            ignores: [
                // Config files — `<tool>.config.*`.
                '**/*.config.*',
                // Drizzle migration artifacts are TOOL-GENERATED and numbered/snake_case
                // (e.g. `0005_identity_reset.*`). They mirror generated SQL, not source we name, and
                // `meta/_journal.json` references them BY FILENAME — renaming them breaks migration.
                '**/database/migrations/**',
                '**/db/migrations/**',
                // Next.js framework-mandated file names — allowed, not renameable.
                '**/next-env.d.ts',
                '**/{page,layout,route,not-found,global-error,template,loading,error,default,middleware,instrumentation,instrumentation-client,sitemap,robots,manifest,opengraph-image,twitter-image,icon,apple-icon}.{ts,tsx,js,jsx}',
                // Expo Router route files — special prefixes/dynamic segments the router requires.
                '**/_layout.{ts,tsx,js,jsx}',
                '**/+*.{ts,tsx,js,jsx}',
                '**/[[]*[]]*.{ts,tsx,js,jsx}',
            ],
            plugins: { 'check-file': checkFile },
            rules: {
                // §1 — camelCase modules; PascalCase when the file's subject is a class or a React
                // component. The glob accepts a leading letter followed by alphanumerics only, which
                // admits camelCase and PascalCase while rejecting BOTH kebab-case and snake_case.
                // `ignoreMiddleExtensions` keeps role/variant tags (`.service`, `.native`, `.test`,
                // `.integration`, `.e2e`, `.spec`) transparent to the check.
                'check-file/filename-naming-convention': [
                    'error',
                    { '**/*.{ts,tsx,js,jsx}': '[a-zA-Z]*([a-zA-Z0-9])' },
                    { ignoreMiddleExtensions: true },
                ],
            },
        },
    ];
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
 *    single camelCase/PascalCase regime -- there is no per-package variant (see §1).
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
            /**
             * ⚠️ These are the ONLY thing standing between `eslint .` and a package's build output.
             *
             * Every package's `lint` script is the bare `eslint .` (pinned by
             * `packages/infra/global/__tests__/staticAnalysisCoverage.test.ts`) because a per-package glob is a
             * claim about a file tree that only the tree can settle — `lib/**\/*.ts` looked correct beside a
             * `lib/` directory while 62 conformance suites in the `__tests__/` next to it were linted by nothing.
             * Handing ESLint the directory removes the glob, and moves the whole exclusion decision HERE, where
             * it is written once.
             *
             * The generated-output entries are not speculative tidiness: measured before they were added,
             * `eslint .` in `packages/infra/global` picked up 9 files from `cdk.out/` and 3 from `dist-lambda/`.
             * They are all gitignored, so they are invisible to the coverage guard and would have failed the
             * lint run instead — a synthesized CDK asset or an esbuild bundle is not source and is in no
             * tsconfig project, so type-aware parsing reports it as a fatal error rather than a rule violation.
             *
             * ⚠️ EVERY output entry is `**\/`-prefixed, and that prefix is load-bearing. A flat-config `ignores`
             * pattern with no slash-prefix is anchored at the config's directory, so a bare `dist/**` matches
             * `<pkg>/dist` and NOT `<pkg>/infra/dist` — measured: 35 compiled `infra/dist/**` files became fatal
             * parse errors in four services the first time `eslint .` ran.
             *
             * The `*.config.*` entry is the one that is deliberately NOT recursive: the exemption is for a
             * workspace-ROOT tool manifest (`vitest.config.ts`, `playwright.config.ts`, `metro.config.cjs`),
             * which most packages cannot put in a project rooted at `src` anyway (TS6059) and which fails loudly
             * when its own tool runs it. A nested `src/sentry.server.config.ts` is ordinary application code and
             * stays linted — `@commise/web` used a `**\/*.config.*` ignore and hid exactly that.
             */
            ignores: [
                '**/node_modules/**',
                // Compiler / bundler / framework output.
                '**/dist/**',
                '**/dist-lambda/**',
                // The Lambda@Edge verifier bundle (ADR-0020) — a separate output root from `dist-lambda`
                // because CDK packages the directory it is given, and the viewer-request code limit is 1 MB.
                '**/dist-edge/**',
                '**/.next/**',
                '**/.expo/**',
                '**/build/**',
                '**/out/**',
                // Tool caches and reports.
                '**/cdk.out/**',
                '**/.turbo/**',
                '**/coverage/**',
                '**/playwright-report/**',
                '**/test-results/**',
                // Workspace-ROOT tool manifests only — see the note above on why this one is not recursive.
                '*.config.js',
                '*.config.cjs',
                '*.config.mjs',
                '*.config.ts',
                '**/*.mjs',
            ],
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
            /**
             * Plain-JS sources are parsed WITHOUT a project — and are therefore LINTED rather than skipped.
             *
             * `tseslint.configs.recommended` spreads its `base` block with no `files` restriction, so the
             * TypeScript parser is applied to `.js` as well, and the `project` set above then makes every `.js`
             * file outside a tsconfig a FATAL parse error. Measured when `eslint .` first ran: the 17 k6 load
             * scripts under `packages/services/*\/tests/load/`, which the k6 BINARY (not Node) executes and which
             * no tsconfig covers, plus `metro.config.cjs`.
             *
             * Adding them to `ignores` was the easy answer and the wrong one: they are real code, and
             * `no-unused-vars`, `curly`, `no-irregular-whitespace` and the bracket-notation `process.env` rule
             * all apply to them without needing a type. Clearing `project` costs nothing here because this config
             * enables `recommended`, NOT `recommendedTypeChecked` — no enabled rule asks for type information.
             *
             * ⚠️ MUST come AFTER the block that sets `project`: flat config resolves later matching objects over
             * earlier ones, so an override placed above the block it overrides does nothing.
             */
            files: ['**/*.js', '**/*.cjs', '**/*.jsx'],
            languageOptions: {
                parserOptions: {
                    project: null,
                },
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
            /**
             * The k6 load tier runs in the k6 BINARY's own JS runtime, not Node, so its four injected globals
             * exist in no `globals` package: `__ENV` (the CLI's `-e` map), `__VU` / `__ITER` (the virtual-user and
             * iteration counters) and `open()` (k6's synchronous init-context file read).
             *
             * Declared rather than silenced: measured at 79 `no-undef` errors across the three services' load
             * tiers the first time those files were linted, and every one was this. Turning `no-undef` off for the
             * directory instead would also stop it catching a genuine typo, which is the only reason to run it.
             *
             * Scoped by the `tests/load/` path because that is where `docs/CODING_STANDARDS.md` §7 puts the k6
             * tier, and it is the only place these globals are legitimate.
             */
            files: ['**/tests/load/**/*.js'],
            languageOptions: {
                globals: {
                    __ENV: 'readonly',
                    __ITER: 'readonly',
                    __VU: 'readonly',
                    open: 'readonly',
                },
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
                                //
                                // ⚠️ THIS LIST IS A COPY OF THE MANIFESTS' `exports` MAPS, and a copy cannot
                                // tell that the original has grown. It had: `recipe-core`'s
                                // `./database-name` and `recipe-workers`' `./infra` were declared exports
                                // that this list did not name, so the rule fired on five imports of a
                                // PUBLISHED entry point — false positives against its own stated intent,
                                // invisible until `infra/**` entered the lint subject. `__tests__/subpath-
                                // exports.test.js` now discovers every declared `@kitchensink/*` subpath and
                                // fails when one is missing here, so the divergence cannot recur silently.
                                group: [
                                    '@kitchensink/*/*',
                                    '!@kitchensink/*/database',
                                    '!@kitchensink/*/database/*',
                                    '!@kitchensink/*/database-name',
                                    // `recipe-core` publishes three modules as their own entry points,
                                    // deliberately kept OFF its barrel: `scaling` (display-only serving
                                    // scaling), `external-url` (the outbound-link trust boundary),
                                    // `food-name` (the canonical form of a shared catalog name, used by BOTH
                                    // services) and `ingredient-quantity` (the exact|range|absent quantity
                                    // value object, which U8 promotes to the barrel in the commit that puts
                                    // it on the wire). The barrel is inside the recipe service's contract
                                    // corpus, so anything re-exported from it lands in `CONTRACT_HASH` — see
                                    // that barrel's note, and `food-name`'s own header for why a
                                    // Unicode-hygiene fix must not move a wire fingerprint.
                                    '!@kitchensink/*/scaling',
                                    '!@kitchensink/*/external-url',
                                    '!@kitchensink/*/food-name',
                                    '!@kitchensink/*/ingredient-quantity',
                                    // `food-service` spells the same barrel `db/schema`, not `database/*`. It
                                    // has no importer yet, which is exactly why the omission was invisible.
                                    '!@kitchensink/*/db',
                                    '!@kitchensink/*/db/*',
                                    '!@kitchensink/*/infra',
                                    '!@kitchensink/*/types',
                                    '!@kitchensink/*/types/*',
                                    '!@kitchensink/*/hooks',
                                    '!@kitchensink/*/testing',
                                    '!@kitchensink/*/users',
                                    '@kitchensink/*/users/*',
                                    '!@kitchensink/*/users/handle-sync-publisher',
                                    // The four shared TOOLING packages, allowed per-package rather than
                                    // per-name: each declares a wildcard `"./*"` export, so subpath import IS
                                    // their entire API (`@kitchensink/eslint/nativeA11y`,
                                    // `@kitchensink/esbuild/library`, `@kitchensink/vitest/base`,
                                    // `@kitchensink/typescript/fix-declaration-paths`). There is no "internal"
                                    // to protect, and naming each subpath would rebuild the copy above.
                                    '!@kitchensink/esbuild/*',
                                    '!@kitchensink/eslint/*',
                                    '!@kitchensink/typescript/*',
                                    '!@kitchensink/vitest/*',
                                ],
                                message:
                                    "Import a package's barrel '@kitchensink/<package>' or one of its declared subpath exports (database/*, database-name, scaling, external-url, food-name, infra, types/*, hooks, testing, users/handle-sync-publisher, or any subpath of the shared tooling packages) — don't reach into other internals.",
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
                    {
                        // `sql.raw` SPLICES ITS ARGUMENT INTO THE STATEMENT TEXT, bypassing parameterisation by
                        // design — so the value's provenance is the only thing between it and SQL injection.
                        //
                        // Banned outright rather than reviewed case-by-case, because the audit that motivated
                        // this found the repo's three `sql.raw` sites were all safe *by virtue of their
                        // callers* (each argument was a module constant or a construction default), with
                        // nothing in the build that would notice when a later refactor turned one of those
                        // constants into a request value. Safety that has to be re-derived by hand on every
                        // future edit is not safety. All three were rewritten to bound parameters — an interval
                        // as `${VALUE}::interval`, a row cap as `LIMIT ${value}` — which is both injection-proof
                        // AND fails closed on a malformed value (Postgres rejects the cast) instead of
                        // executing it. That left ZERO call sites, so this rule costs nothing to keep.
                        //
                        // The parameterising `sql` tag and its `${}` interpolations are untouched: those ARE
                        // the correct form, and every DAL should keep using them.
                        selector:
                            "CallExpression[callee.type='MemberExpression'][callee.object.name='sql'][callee.property.name='raw']",
                        message:
                            'Do not use sql.raw() — it splices its argument into the statement text and bypasses parameterisation. Use a bound parameter instead: `${value}` for a LIMIT/OFFSET, `${value}::interval` for an interval. If an identifier really must be dynamic, map it through a hard-coded allow-list first.',
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
