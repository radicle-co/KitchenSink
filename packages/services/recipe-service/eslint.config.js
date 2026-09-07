import { createConfig, restrictedImportsRule } from '@kitchensink/eslint';

const base = createConfig('./tsconfig.json', import.meta.dirname);

/**
 * Keep the raw caller credential readable in exactly ONE place (issue #120).
 *
 * `revealCallerToken` is the only way to get the caller's bearer bytes out of the opaque `CallerToken` value
 * object, and the only legitimate reason to want them is to build the `Authorization` header for the ONE
 * config-supplied food-service origin — which is what `ingredients/FoodServiceClients.factory.ts` does. Any
 * other importer would widen a forwarded user credential's blast radius (a new outbound call, a log line, a
 * response body), so it is a lint error rather than a convention someone has to remember. Modules may still
 * hold and pass a `CallerToken` freely; they just cannot read it.
 *
 * If you are hitting this rule: pass the `CallerToken` along instead of unwrapping it.
 *
 * ⛔ COMPOSED with the shared rule through {@link restrictedImportsRule}, never spelled as a bare
 * `no-restricted-imports` entry of its own. In ESLint flat config a later config object's rule entry
 * REPLACES the earlier one — options do not merge — so writing `{ paths: [...] }` here switched the base
 * config's `patterns` allow-list (the "don't reach into another package's internals" guard) OFF for every
 * `src/**\/*.ts` in this package. Measured on an identical probe file importing
 * `@kitchensink/recipe-core/src/parsing/parseKey.js`: `contract/zzprobe.ts` reported the error and
 * `src/zzprobe.ts` was clean. `packages/infra/global/__tests__/restrictedImportsOverride.test.ts` now
 * fires that probe at the real config from inside `src/`, so the override cannot come back quietly.
 */
const restrictCredentialAccessor = {
    files: ['src/**/*.ts'],
    ignores: ['src/ingredients/FoodServiceClients.factory.ts', 'src/auth/CallerToken.ts', 'src/**/__tests__/**'],
    rules: {
        'no-restricted-imports': restrictedImportsRule([
            {
                name: './CallerToken.js',
                importNames: ['revealCallerToken'],
                message:
                    'revealCallerToken is restricted to ingredients/FoodServiceClients.factory.ts — pass the CallerToken along instead of unwrapping the credential.',
            },
            {
                name: '../auth/CallerToken.js',
                importNames: ['revealCallerToken'],
                message:
                    'revealCallerToken is restricted to ingredients/FoodServiceClients.factory.ts — pass the CallerToken along instead of unwrapping the credential.',
            },
            {
                name: '../../auth/CallerToken.js',
                importNames: ['revealCallerToken'],
                message:
                    'revealCallerToken is restricted to ingredients/FoodServiceClients.factory.ts — pass the CallerToken along instead of unwrapping the credential.',
            },
        ]),
    },
};

export default [
    ...base,
    restrictCredentialAccessor,
    {
        // CDK infra is a SEPARATE tsconfig project, so type-aware lint needs the parser pointed at it — the same
        // block `@commise/web` already carries. Without it every `infra/**` file is a FATAL parse error ("not
        // found in any of the provided project(s)"): a file ESLint opens and runs no rule on, which is worse than
        // not linting it, because the file still appears in a passing run. The previous workaround was
        // `ignores: ['infra/**']`, which hid the CDK code that provisions production from the entire config —
        // including the `sql.raw` ban and the bracket-notation env rule.
        files: ['infra/**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: './infra/tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        // Grandfathered camelCase names, surfaced the moment `infra/**` entered the lint subject — the same
        // treatment `identity` and `identity-webhooks` already give their pre-§1a names, and for the same reason:
        // `deployedSmoke.ts` is invoked BY PATH from four workflow steps (`prod-deploy.yml` ×3,
        // `sandbox-deploy.yml` ×1) and is named in ADR-0010 and ADR-0011, so renaming it is a CI change that
        // belongs in its own commit rather than riding along with a lint-coverage sweep.
        //
        // The disable is per-FILE, not per-directory, so no NEW non-conforming name can appear in `infra/`.
        files: [
            'infra/smoke/deployedSmoke.ts',
            'infra/__tests__/deployedSmoke.test.ts',
            'infra/__tests__/integration/deployedSmoke.integration.test.ts',
        ],
        rules: {
            'check-file/filename-naming-convention': 'off',
        },
    },
];
