/**
 * The ONE identity transport the mobile app uses: a {@link ProfileServiceClient} bound to this build's identity
 * origin and to the NATIVE Clerk token template.
 *
 * ⚠️ IT IS A SHARED FACTORY BECAUSE A SECOND TRANSPORT IS HOW THE SKEW GUARD GOT BYPASSED. The app previously had
 * two ways to reach identity: this client (from `useUserProfile`) and `services/api.ts`'s hand-rolled `apiRequest`
 * (from `useAvatarUpload`). Only the client's transport funnel compares the `CONTRACT_HASH` this binary bundles
 * against the fingerprint the deployed service publishes, so the avatar path — in a RELEASED binary, the one
 * consumer that cannot be rebuilt alongside a backend deploy — was outside drift layer 3 (GR-017 §17-b.5, ADR-0014
 * §15.2.5). `apiRequest` is retired rather than fixed: leaving an unguarded door open makes the guard something a
 * future call site has to remember, instead of something it inherits.
 *
 * Native tokens are `azp`-less, so both services only admit them when minted from {@link NATIVE_JWT_TEMPLATE}.
 *
 * DESIGN PATTERN: Factory (one construction site for the client) + Adapter (Clerk's `getToken` adapted to the
 * client's platform-agnostic `TokenSource`).
 */
import { ProfileServiceClient, UnauthorizedError } from '@commise/features-account';
import { useAuth as useIdpAuth } from '@clerk/expo';
import { useMemo } from 'react';

import { NATIVE_JWT_TEMPLATE } from '../auth/nativeToken.js';
import { env } from '../config/env.js';

/**
 * Build (and memoize per Clerk identity) the identity client every mobile identity call goes through.
 *
 * `forceRefresh` is honoured per call rather than per client: the profile READ always re-mints (Clerk session
 * tokens live ~60s, and a query refetching after the app returns from background otherwise sends an expired cached
 * token and 401s — mobile-specific, since the web server component mints a fresh token per SSR request), while
 * mutations and the avatar presign accept a cached one. A resolved-but-empty token throws before any request.
 */
export function useProfileServiceClient(): ProfileServiceClient {
    const { getToken } = useIdpAuth();

    return useMemo(
        () =>
            new ProfileServiceClient({
                baseUrl: env.EXPO_PUBLIC_IDENTITY_API_URL,
                token: async (options) => {
                    const token = await getToken({
                        template: NATIVE_JWT_TEMPLATE,
                        skipCache: options?.forceRefresh ?? false,
                    });

                    if (!token) {
                        throw new UnauthorizedError('Not authenticated', 'unauthenticated');
                    }

                    return token;
                },
            }),
        [getToken],
    );
}
