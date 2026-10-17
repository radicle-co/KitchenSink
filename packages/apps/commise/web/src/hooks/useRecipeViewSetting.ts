'use client';

/**
 * `useRecipeViewSetting` — the web read and write of the recipe library's grid/list choice, an ACCOUNT setting
 * (ADR-0059, owner ruling 2026-10-17; it was a cookie).
 *
 * A thin adapter over the shared hook of `@commise/features-account`, which owns what is read, written and rolled back for
 * both apps. Web adds only what is web-bound: the Clerk session (signed out, nothing is read) and the identity client with
 * its 401 recovery. The server render has already put the setting in the cache (`lib/prefetchUserSettings`), so the first
 * client render is the cook's view.
 */
import { useAuth } from '@clerk/nextjs';
import { useRecipeViewSetting as useSharedRecipeViewSetting } from '@commise/features-account';
import type { RecipeViewSetting } from '@commise/features-account';

import { useProfileServiceClient } from '@/hooks/useProfileServiceClient';

/**
 * @returns The cook's grid/list choice (or none), how to make one, and whether the last one failed to save.
 */
export function useRecipeViewSetting(): RecipeViewSetting {
    const { isSignedIn } = useAuth();
    const client = useProfileServiceClient();

    return useSharedRecipeViewSetting(client, Boolean(isSignedIn));
}
