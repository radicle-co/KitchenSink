'use client';

/**
 * `useUserProfile` — the web client read of the signed-in viewer's identity profile (`GET /api/v1/users/me`),
 * exposing `account.paidFeatures` — read through `paidFeatureStateOf` — so every paid feature and upsell renders from
 * one answer (plan 2026-10-14-009 D13). This mirrors the mobile hook (`apps/commise/mobile/src/hooks/useUserProfile.ts`)
 * so web and mobile gate identically — the enforced cross-platform rule (CODING_STANDARDS §14).
 *
 * The bearer token is minted per fetch from Clerk's session (`useAuth().getToken`); the query is disabled
 * while signed out. It shares the app's `QueryClientProvider` (mounted in `[locale]/layout.tsx`), so the
 * profile is cached and deduped across every consumer under a stable key.
 *
 * The query key + `staleTime` are NOT declared here — both live ONCE in `@commise/features-account`'s
 * `profileQueries` factory (B12), which this hook and the mobile hook both consume, so the two platforms
 * cannot drift to different cache policies again.
 */
import { useAuth } from '@clerk/nextjs';
import { profileQueries } from '@commise/features-account';
import type { UserProfile } from '@kitchensink/schema-identity';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { createProfileServiceClient } from '@/lib/identityServiceClient';

/**
 * Read the signed-in viewer's identity profile via TanStack Query.
 *
 * @returns The query result; `data.account.paidFeatures` drives every paid-feature surface. Idle while signed out.
 */
export function useUserProfile(): UseQueryResult<UserProfile> {
    const { getToken, isSignedIn } = useAuth();

    return useQuery({
        ...profileQueries(createProfileServiceClient(async () => (await getToken()) ?? '')).me(),
        enabled: Boolean(isSignedIn),
    });
}
