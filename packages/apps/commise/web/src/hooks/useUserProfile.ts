'use client';

/**
 * `useUserProfile` — the web client read of the signed-in viewer's identity profile (`GET /v1/users/me`),
 * exposing `account.subscriptionTier` so client components can gate premium-only capabilities (e.g. making a
 * recipe private, C-004). This mirrors the mobile hook (`apps/commise/mobile/src/hooks/useUserProfile.ts`)
 * so web and mobile gate identically — the enforced cross-platform rule (CODING_STANDARDS §14).
 *
 * The bearer token is minted per fetch from Clerk's session (`useAuth().getToken`); the query is disabled
 * while signed out. It shares the app's `QueryClientProvider` (mounted in `[locale]/layout.tsx`), so the
 * profile is cached and deduped across every consumer under a stable key.
 */
import { useAuth } from '@clerk/nextjs';
import type { UserProfile } from '@kitchensink/identity-service';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { createProfileServiceClient } from '@/lib/identityServiceClient';

/** Stable cache key for the current viewer's profile (shared with any future profile consumers). */
export const USER_PROFILE_QUERY_KEY = ['user', 'me'] as const;

/** Profile cache lifetime — the tier changes rarely, so a 2-minute stale window avoids refetch churn. */
const PROFILE_STALE_TIME_MS = 2 * 60 * 1000;

/**
 * Read the signed-in viewer's identity profile via TanStack Query.
 *
 * @returns The query result; `data.account.subscriptionTier` drives premium gating. Idle while signed out.
 */
export function useUserProfile(): UseQueryResult<UserProfile> {
    const { getToken, isSignedIn } = useAuth();

    return useQuery({
        queryKey: USER_PROFILE_QUERY_KEY,
        queryFn: async () => {
            const token = (await getToken()) ?? '';

            return createProfileServiceClient(token).getMe();
        },
        enabled: Boolean(isSignedIn),
        staleTime: PROFILE_STALE_TIME_MS,
    });
}
