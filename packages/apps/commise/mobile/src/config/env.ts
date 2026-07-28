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
 *   - The identity origin also fell back to the RECIPE origin, sending `/v1/users/me` to a service that
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
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/** An absolute http(s) base URL. */
const endpointUrl = z.url({ protocol: /^https?$/ });

export const env = createEnv({
    clientPrefix: 'EXPO_PUBLIC_',

    client: {
        EXPO_PUBLIC_RECIPE_API_URL: endpointUrl,
        EXPO_PUBLIC_IDENTITY_API_URL: endpointUrl,
    },

    runtimeEnv: {
        EXPO_PUBLIC_RECIPE_API_URL: process.env.EXPO_PUBLIC_RECIPE_API_URL,
        EXPO_PUBLIC_IDENTITY_API_URL: process.env.EXPO_PUBLIC_IDENTITY_API_URL,
    },

    /** A blank value is a missing value, not an origin. */
    emptyStringAsUndefined: true,

    onValidationError: (issues) => {
        const names = [...new Set(issues.map((issue) => issue.path?.join('.')).filter(Boolean))].join(', ');

        throw new Error(
            `Invalid environment variables: ${names}. ` +
                'Each must be an absolute http(s) URL. There is no default — set them for this stage ' +
                '(local: .env.development; device/EAS: the build environment). See src/config/env.ts.',
        );
    },
});
