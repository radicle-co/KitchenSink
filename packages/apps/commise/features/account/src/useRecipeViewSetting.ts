/**
 * @module @commise/features-account — the recipe library's grid/list choice as an ACCOUNT setting (ADR-0059, owner
 * ruling 2026-10-17). It was a cookie on web and device storage on native; both are gone, so the choice follows the cook
 * to another browser or phone like every other setting.
 *
 * ONE hook for both platforms, so what is read, what is written, and when it is rolled back cannot differ. The query,
 * its `placeholderData` and the optimistic write with its rollback are `profileQueries` and `profileMutations`, not
 * restated here; this hook only projects them onto what the library screens ask: the cook's CHOICE (or none), a way to
 * make one, and whether the last one failed to save.
 *
 * The server answers `auto` to a cook who never chose. That is "no choice": the screen then picks by the width it has,
 * and a phone's pick is never stored, so it cannot pin a later wide screen.
 *
 * @pattern Headless hook — a projection of the settings query and its optimistic mutation
 * @sideEffect Reads `GET /api/v1/users/me/settings` and sends `PATCH` on a choice, through the given client.
 */
import { useMutation, useQuery } from '@tanstack/react-query';

import { profileMutations } from './mutations.js';
import type { ProfileServiceClient } from './profileServiceClient.js';
import { profileQueries } from './queries.js';

/** The library layouts a cook can choose; `auto` is the absence of a choice and is never sent. */
export type RecipeViewChoice = 'grid' | 'list';

/** What a library screen needs from the setting. */
export interface RecipeViewSetting {
    /** The cook's stored choice, or `undefined` when they never made one (the width picks). */
    readonly viewChoice: RecipeViewChoice | undefined;
    /** Choose a layout. Not awaited: the cache already shows it, and a save made offline resumes by itself. */
    readonly chooseView: (mode: RecipeViewChoice) => void;
    /** Whether the last choice failed to save. The view has already gone back to what it was. Clears on the next choice. */
    readonly saveFailed: boolean;
}

/**
 * Read and write the recipe library's grid/list choice.
 *
 * @param client - The identity client.
 * @param enabled - Whether a session exists. Signed out, nothing is read and there is no choice.
 * @returns The choice, how to make one, and whether the last one failed to save.
 */
export function useRecipeViewSetting(client: ProfileServiceClient, enabled: boolean): RecipeViewSetting {
    const settings = useQuery({ ...profileQueries(client).settings(), enabled });
    const patchSettings = useMutation(profileMutations(client).patchSettings());
    const stored = enabled ? settings.data?.recipeViewMode : undefined;

    return {
        viewChoice: stored === 'grid' || stored === 'list' ? stored : undefined,
        chooseView: (mode) => patchSettings.mutate({ recipeViewMode: mode }),
        saveFailed: patchSettings.isError,
    };
}
