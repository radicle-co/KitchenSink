import { createConfig } from '@kitchensink/eslint';

const base = createConfig('./tsconfig.json', import.meta.dirname);

/**
 * Keep the raw caller credential readable in exactly ONE place (issue #120).
 *
 * `revealCallerToken` is the only way to get the caller's bearer bytes out of the opaque `CallerToken` value
 * object, and the only legitimate reason to want them is to build the `Authorization` header for the ONE
 * config-supplied food-service origin — which is what `ingredients/food-service-clients.factory.ts` does. Any
 * other importer would widen a forwarded user credential's blast radius (a new outbound call, a log line, a
 * response body), so it is a lint error rather than a convention someone has to remember. Modules may still
 * hold and pass a `CallerToken` freely; they just cannot read it.
 *
 * If you are hitting this rule: pass the `CallerToken` along instead of unwrapping it.
 */
const restrictCredentialAccessor = {
    files: ['src/**/*.ts'],
    ignores: ['src/ingredients/food-service-clients.factory.ts', 'src/auth/caller-token.ts', 'src/**/__tests__/**'],
    rules: {
        'no-restricted-imports': [
            'error',
            {
                paths: [
                    {
                        name: './caller-token.js',
                        importNames: ['revealCallerToken'],
                        message:
                            'revealCallerToken is restricted to ingredients/food-service-clients.factory.ts — pass the CallerToken along instead of unwrapping the credential.',
                    },
                    {
                        name: '../auth/caller-token.js',
                        importNames: ['revealCallerToken'],
                        message:
                            'revealCallerToken is restricted to ingredients/food-service-clients.factory.ts — pass the CallerToken along instead of unwrapping the credential.',
                    },
                    {
                        name: '../../auth/caller-token.js',
                        importNames: ['revealCallerToken'],
                        message:
                            'revealCallerToken is restricted to ingredients/food-service-clients.factory.ts — pass the CallerToken along instead of unwrapping the credential.',
                    },
                ],
            },
        ],
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
