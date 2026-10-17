/**
 * @module webDiscoveryPlatform — the web side of the shared discovery screen's platform port: the read boundary that waits
 * for hydration unless the server holds the data, the calorie lookup that waits for hydration, and `localStorage` for
 * the recent searches.
 *
 * A module constant on purpose: the shared screen calls `useRenderNutrition`, `useRefreshNotice` and `useRecoverySignal` as hooks, so the object must be stable.
 *
 * @pattern Adapter — the discovery platform port over the web app's hydration-aware pieces
 */
import { useAuth } from '@clerk/nextjs';
import type { DiscoveryPlatform } from '@commise/features-recipes/discovery';
import { useRecoverySignal } from '@commise/query/recovery-signal';
import { useRefreshNotice } from '@commise/query/refresh-notice';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';
import { useHydratedNutrition } from '@/hooks/useHydratedNutrition';
import { webRecentSearchStore } from '@/lib/recentSearchStore';

/**
 * Whose recent searches these are: Clerk's `userId` (`undefined` while Clerk loads, `null` signed out), the id the sign-out
 * command removes the history by.
 */
function useRecentSearchSubject(): string | null | undefined {
    return useAuth().userId;
}

/** The web discovery platform. */
export const webDiscoveryPlatform: DiscoveryPlatform = {
    Boundary: ClientQueryBoundary,
    useRenderNutrition: useHydratedNutrition,
    useRefreshNotice,
    useRecoverySignal,
    recentSearchStore: webRecentSearchStore,
    useRecentSearchSubject,
};
