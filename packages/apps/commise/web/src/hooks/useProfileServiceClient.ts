'use client';

/**
 * `useProfileServiceClient` — the identity client every WEB client component reads and writes through.
 *
 * A thin adapter over the shared `useProfileServiceClient` of `@commise/features-account`, which owns the token policy
 * both apps follow: no session token means no request (never `Authorization: Bearer ` with no value), and a refused
 * bearer is replayed once with a freshly minted token (`forceRefresh` reaches Clerk as `skipCache`). Web adds only what
 * is web-bound, through {@link createProfileServiceClient}: the identity origin and the 401 redirect to sign-in.
 *
 * The token is minted per request, never captured at render: a session token lives about a minute, so one captured
 * while the cook typed slowly would be stale.
 */
import { useAuth } from '@clerk/nextjs';
import { useProfileServiceClient as useSharedProfileServiceClient } from '@commise/features-account';
import type { ProfileServiceClient } from '@commise/features-account';

import { createProfileServiceClient } from '@/lib/identityServiceClient';

/**
 * @returns The memoized identity client for the signed-in session.
 */
export function useProfileServiceClient(): ProfileServiceClient {
    const { getToken } = useAuth();

    return useSharedProfileServiceClient({ getToken, build: createProfileServiceClient });
}
