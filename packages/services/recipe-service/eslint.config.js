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

export default [...base, restrictCredentialAccessor];
