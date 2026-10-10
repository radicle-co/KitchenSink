'use client';

/**
 * `useUserSettings` — the web read of the signed-in viewer's settings (`GET /api/v1/users/me/settings`, ADR-0059).
 *
 * Preferences live on the server (owner ruling D19), so they follow the cook across devices and none is kept in
 * browser storage. The query key, `staleTime` and the `placeholderData` (the server's published defaults) are NOT
 * declared here: they live once in `@commise/features-account`'s `profileQueries` factory, as the profile read's do.
 *
 * The bearer token is minted per fetch from Clerk's session; the query is disabled while signed out.
 */
import { useAuth } from '@clerk/nextjs';
import { profileQueries } from '@commise/features-account';
import type { UserSettings } from '@kitchensink/schema-identity';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { createProfileServiceClient } from '@/lib/identityServiceClient';

/**
 * Read the signed-in viewer's settings via TanStack Query.
 *
 * @returns The query result. `data` is the published default until the first read answers, and is `undefined` only
 *   when the query has neither.
 */
export function useUserSettings(): UseQueryResult<UserSettings> {
    const { getToken, isSignedIn } = useAuth();

    return useQuery({
        ...profileQueries(createProfileServiceClient(async () => (await getToken()) ?? '')).settings(),
        enabled: Boolean(isSignedIn),
    });
}
