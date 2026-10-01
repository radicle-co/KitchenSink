/**
 * `queryOptions` factory module for `@commise/features-account` (CP-9/B12), mirroring the P5 pattern in
 * `@kitchensink/recipe-service-client/queries.ts`: a `queryOptions` builder derived from a configured
 * client, so the query key + cache policy live in ONE place instead of each caller re-declaring them.
 *
 * `web/src/hooks/useUserProfile.ts` and `mobile/src/hooks/useUserProfile.ts` both build their `useQuery` call
 * from {@link profileQueries}`(client).me(...)`, so the two platforms cannot hold independent copies of the
 * same cache-addressing decision.
 *
 * **staleTime — 2 minutes.** `account.subscriptionTier` is DERIVED from the signed token's `permissions`
 * (identity's `users/domain/subscriptionTier.ts`); there is no explicit upgrade/downgrade write, so the tier
 * changes when a token is re-minted with a different grant. That reaches the viewer within one token lifetime
 * either way, and refetching the profile more often than that would spend requests to learn nothing.
 */
import { queryOptions } from '@tanstack/react-query';

import type { ProfileRequestOptions } from './profileServiceClient.js';
import type { ProfileServiceClient } from './profileServiceClient.js';

/** Stable query-key factory for the viewer's profile — the single cache address both platforms share. */
export const profileServiceKeys = {
    /** `GET /api/v1/users/me` — the signed-in viewer's identity profile. */
    me: ['user', 'me'] as const,
};

/** Profile cache lifetime — see the module doc for why 2 minutes. */
export const PROFILE_STALE_TIME_MS = 2 * 60 * 1000;

/**
 * `queryOptions` factories for the viewer-profile read.
 *
 * @param client - The configured {@link ProfileServiceClient} the factory's fetcher calls through.
 * @returns One `queryOptions` builder for the viewer profile.
 */
export function profileQueries(client: ProfileServiceClient) {
    return {
        /**
         * `GET /api/v1/users/me` — the signed-in viewer's profile. `options` is forwarded to
         * `client.getMe(...)` unchanged, so a caller can still request a forced token refresh (mobile's
         * policy — see `mobile/src/hooks/useUserProfile.ts`) without this factory hard-coding either
         * platform's choice.
         */
        me: (options?: ProfileRequestOptions) =>
            queryOptions({
                queryKey: profileServiceKeys.me,
                queryFn: () => client.getMe(options),
                staleTime: PROFILE_STALE_TIME_MS,
            }),
    };
}
