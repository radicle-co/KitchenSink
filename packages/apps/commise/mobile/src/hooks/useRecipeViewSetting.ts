/**
 * `useRecipeViewSetting` — the mobile read and write of the recipe library's grid/list choice, an ACCOUNT setting
 * (ADR-0059, owner ruling 2026-10-17). It replaces `useStoredViewMode`, which kept the choice per device in
 * `AsyncStorage`; the choice now follows the cook to another phone or the web.
 *
 * A thin adapter over the shared hook of `@commise/features-account`, which owns what is read, written and rolled back for
 * both apps (so web and mobile cannot disagree). Mobile adds only what is mobile-bound: the Clerk session (signed out,
 * nothing is read) and the identity client with the native token template.
 */
import { useAuth as useIdpAuth } from '@clerk/expo';
import { useRecipeViewSetting as useSharedRecipeViewSetting } from '@commise/features-account';
import type { RecipeViewSetting } from '@commise/features-account';

import { useProfileServiceClient } from './useProfileServiceClient.js';

/**
 * @returns The cook's grid/list choice (or none), how to make one, and whether the last one failed to save.
 */
export function useRecipeViewSetting(): RecipeViewSetting {
    const { isSignedIn } = useIdpAuth();
    const client = useProfileServiceClient();

    return useSharedRecipeViewSetting(client, Boolean(isSignedIn));
}
