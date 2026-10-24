/**
 * @module config/env — the ONE place the mobile app learns which backends to call.
 *
 * The native counterpart of `web/src/config/env.ts`, and deliberately identical in posture: every endpoint
 * is declared here, validated at module load, and has **no default**. A build that was not told its
 * endpoints fails loudly instead of shipping a binary that points somewhere useless.
 *
 * ## Why no fallback (the defaults this replaces were actively harmful)
 *
 * `EXPO_PUBLIC_*` is inlined by Babel at BUILD time, so a fallback is frozen into the shipped app:
 *
 *   - `?? 'http://localhost:3000'` — on a phone, `localhost` is the PHONE. It never means the developer's
 *     machine, so this default cannot be right in any deployed build; it only ever produces
 *     connection failures that look like a network bug.
 *   - `?? 'https://api.commise.io'` — a hardcoded guess at a production hostname that nothing in this repo
 *     provisions. Shipping it points the app at a domain the team does not control.
 *   - The identity origin also fell back to the RECIPE origin, sending `/api/v1/users/me` to a service that
 *     does not serve it — a 404 on the profile screen instead of a clear "you forgot to configure this".
 *
 * Identity and recipe are separate deployables on separate hosts (`identity.{stage}` vs `recipe.{stage}`,
 * with no cross-service proxy), so the two origins are independent and neither can stand in for the other.
 *
 * ## Where the values come from
 *
 * Expo reads `.env` files itself, so local development is configured by the committed `.env.development`;
 * a device/EAS build takes them from that build's environment. As on web, `runtimeEnv` repeats each name
 * literally because only a static `process.env.X` member expression is inlined — a dynamic lookup would be
 * `undefined` on device.
 */
import { endpointUrl, envValidationError } from '@commise/features-core/config/envScaffolding';
import { findStageIncoherence } from '@commise/features-core/config/stageCoherence';
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
    clientPrefix: 'EXPO_PUBLIC_',

    client: {
        EXPO_PUBLIC_RECIPE_API_URL: endpointUrl,
        EXPO_PUBLIC_IDENTITY_API_URL: endpointUrl,
        EXPO_PUBLIC_FOOD_API_URL: endpointUrl,
        /**
         * The Clerk publishable key. It used to be a bare `process.env` presence check in `AppProviders.tsx`,
         * outside this schema, so a binary built with a SANDBOX key and PRODUCTION URLs booted and then 401'd
         * on every request — the 2026-08-07 outage web already refuses at build. Shape is validated here;
         * the cross-field stage rule is asserted below, because it needs the endpoints too.
         */
        EXPO_PUBLIC_IDP_PUBLISHABLE_KEY: z
            .string()
            .regex(/^pk_(test|live)_[A-Za-z0-9+/=_-]+$/, 'must be a Clerk publishable key (pk_test_… or pk_live_…)'),
    },

    runtimeEnv: {
        EXPO_PUBLIC_RECIPE_API_URL: process.env.EXPO_PUBLIC_RECIPE_API_URL,
        EXPO_PUBLIC_IDENTITY_API_URL: process.env.EXPO_PUBLIC_IDENTITY_API_URL,
        EXPO_PUBLIC_FOOD_API_URL: process.env.EXPO_PUBLIC_FOOD_API_URL,
        EXPO_PUBLIC_IDP_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_IDP_PUBLISHABLE_KEY,
    },

    /** A blank value is a missing value, not an origin. */
    emptyStringAsUndefined: true,

    onValidationError: (issues) => {
        throw envValidationError(
            issues,
            'The API URLs must be absolute http(s) URLs; the Clerk key must be a publishable key ' +
                '(pk_test_… or pk_live_…). There is no default — set them for this stage ' +
                '(local: .env.development; device/EAS: the build environment). See src/config/env.ts.',
        );
    },
});

/**
 * The cross-field rule: the Clerk instance and the API endpoints must belong to the SAME stage — the native
 * twin of the assertion in `web/src/config/env.ts`, run by the SAME function. A sandbox key and a production
 * URL are each individually valid; only the combination is the outage.
 *
 * @sideEffect Throws at module evaluation (app startup) when the configuration is incoherent.
 */
const stageProblems = findStageIncoherence({
    clerkKeyName: 'EXPO_PUBLIC_IDP_PUBLISHABLE_KEY',
    clerkPublishableKey: env.EXPO_PUBLIC_IDP_PUBLISHABLE_KEY,
    endpoints: {
        EXPO_PUBLIC_RECIPE_API_URL: env.EXPO_PUBLIC_RECIPE_API_URL,
        EXPO_PUBLIC_IDENTITY_API_URL: env.EXPO_PUBLIC_IDENTITY_API_URL,
        EXPO_PUBLIC_FOOD_API_URL: env.EXPO_PUBLIC_FOOD_API_URL,
    },
});

if (stageProblems.length > 0) {
    throw new Error(
        `Clerk instance and API endpoints disagree about which stage this build is for:\n` +
            stageProblems.map((problem) => `  - ${problem}`).join('\n') +
            '\nSet a matched pair for this stage. See @commise/features-core/config/stageCoherence.',
    );
}
