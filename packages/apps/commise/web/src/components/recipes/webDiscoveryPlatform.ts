/**
 * @module webDiscoveryPlatform — the web side of the shared discovery screen's platform port: the read boundary that waits
 * for hydration unless the server holds the data, the calorie lookup that waits for hydration, and `localStorage` for
 * the recent searches.
 *
 * A module constant on purpose: the shared screen calls `useRenderNutrition` as a hook, so the object must be stable.
 *
 * @pattern Adapter — the discovery platform port over the web app's hydration-aware pieces
 */
import type { DiscoveryPlatform } from '@commise/features-recipes/discovery';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';
import { useHydratedNutrition } from '@/hooks/useHydratedNutrition';
import { webRecentSearchStore } from '@/lib/recentSearchStore';

/** The web discovery platform. */
export const webDiscoveryPlatform: DiscoveryPlatform = {
    Boundary: ClientQueryBoundary,
    useRenderNutrition: useHydratedNutrition,
    recentSearchStore: webRecentSearchStore,
};
