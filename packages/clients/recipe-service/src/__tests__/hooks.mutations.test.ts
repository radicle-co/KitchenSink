// @vitest-environment jsdom
/**
 * Write-hook contract for the recipe-service mutation hooks (T064 / FR-001, FR-002, FR-004, FR-005,
 * FR-008, FR-011, FR-013, FR-016): every `use*` mutation in `hooks.ts`.
 *
 * Three things are pinned per hook, because they are the only things the hook owns:
 *
 * 1. **The call** — the client method it drives, with the caller's variables forwarded in the right order.
 * 2. **The invalidation** — *exactly* which regions of the query cache go stale on success. This is the
 *    hook layer's most fragile behavior and the one with the worst production failure mode: a missing
 *    invalidation is a silent staleness bug (the write succeeds and the UI keeps showing the old value),
 *    and an over-broad one is a silent refetch storm. It is asserted as an **observable cache outcome** —
 *    seeded probes at literal keys flipping to `isInvalidated` (see `utils/cacheProbes.ts`) — not as "the
 *    spy was called", and every assertion is exact, so under- AND over-invalidation both fail.
 * 3. **The failure path** — the rejection surfaces as the typed error AND invalidates nothing (a failed
 *    write must not evict good cache).
 *
 * Timing: `mutate` is fired inside `act` and the assertion waits on the hook's real settled status. That
 * is not an arbitrary wait — TanStack awaits the `onSuccess`/`onError` callbacks *before* dispatching the
 * terminal status, so an observed `isSuccess` guarantees the hook's invalidation has already run. No fake
 * timers are used anywhere.
 *
 * Every `onSuccess` body now invalidates a **minimal, non-overlapping** set of keys: the dead calls that
 * used to invalidate a key a sibling call already subsumed by prefix (e.g. `recipe(id)` then `recipes`)
 * have been removed, so each expected probe set below reads directly off the hook's calls.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, waitFor } from '@testing-library/react';

import type { CreateRecipeInput, RecipeDetail } from '@kitchensink/recipe-core';

import {
    BadRequestError,
    ForbiddenError,
    GoneError,
    NotFoundError,
    PullDriftError,
    VersionConflictError,
} from '../errors.js';
import {
    invalidateCollections,
    recipeServiceKeys,
    useAddRecipeToCollection,
    useCloneCollection,
    useCloneRecipe,
    useConfirmPhotoUpload,
    useCreateCollection,
    useCreateIngredient,
    useCreatePhotoUploadUrl,
    useCreateRecipe,
    useDeleteCollection,
    useDeleteRecipe,
    useDeleteRecipePhoto,
    useDeleteRecipeRating,
    usePreviewPull,
    usePullCollectionFromSource,
    useRemoveRecipeFromCollection,
    useReorderRecipePhotos,
    useRequestAccountErasure,
    useRestoreRecipeVersion,
    useSetRecipeRating,
    useSetRecipeVisibility,
    useUpdateCollection,
    useUpdateRecipe,
} from '../hooks.js';
import {
    makeCollection,
    makeCollectionRecipeMembership,
    makeErasureAccepted,
    makeIngredient,
    makePullDiff,
    makePullFromSourceResponse,
    makeRecipeDetail,
    makeRecipePhoto,
    makeRestoreVersionResponse,
    makeUploadUrlResponse,
} from '../__fixtures__/recipes.js';
import type { CacheProbeName } from './utils/cacheProbes.js';
import {
    PROBE_COLLECTION_ID,
    PROBE_RECIPE_ID,
    expectedProbes,
    invalidatedProbes,
    seedCacheProbes,
} from './utils/cacheProbes.js';
import { makeGuardedClient, makeTestQueryClient, renderRecipeHook } from './utils/hookHarness.js';

/** Every probe under the `recipes` prefix — what invalidating `recipeServiceKeys.recipes` must reach. */
const ALL_RECIPE_PROBES: readonly CacheProbeName[] = [
    'recipeList',
    'recipeA',
    'recipeAVersions',
    'recipeAPhotos',
    'recipeB',
];

/** Every probe under the `collections` prefix. */
const ALL_COLLECTION_PROBES: readonly CacheProbeName[] = ['collectionList', 'collectionA', 'collectionB'];

/** The probes under recipe A's detail key (its detail, versions, and photos) — but not the list, not B. */
const RECIPE_A_SUBTREE_PROBES: readonly CacheProbeName[] = ['recipeA', 'recipeAVersions', 'recipeAPhotos'];

/**
 * What a library-wide recipe write (create/update/delete/clone/visibility) must stale: every `recipes`
 * query PLUS the recipe-search cache. Search sits under its own `search` namespace, outside the `recipes`
 * prefix, so it takes a second, explicit invalidation — but it is backed by the same golden `recipes` table
 * through a trigger-maintained `search_vector`, so it goes stale in the SAME transaction as the write.
 */
const RECIPE_WRITE_PROBES: readonly CacheProbeName[] = [...ALL_RECIPE_PROBES, 'recipeSearch'];

/**
 * What a recipe-row write that EDITS an existing recipe (update / delete / visibility) must stale (DA2):
 * every `RECIPE_WRITE_PROBES` region PLUS every collection — a `CollectionWithRecipes.recipes` entry embeds
 * the full `Recipe` projection, so an edited title, a changed visibility, or a soft-deleted (now-vanished)
 * member is stale in every cached collection until the `collections` prefix is invalidated. `create`/`clone`
 * are excluded: they mint a NEW recipe that is a member of no collection, so no embed changes.
 */
const RECIPE_EMBED_WRITE_PROBES: readonly CacheProbeName[] = [...RECIPE_WRITE_PROBES, ...ALL_COLLECTION_PROBES];

/**
 * DA3 — what a PATCH `update` on recipe A stales now that the mutation response is written THROUGH to the
 * detail cache instead of triggering a refetch: A's own detail (`recipeA`) and its embedded photos
 * (`recipeAPhotos`) stay VALID — `setQueryData` hydrates them directly, so invalidating them too would just
 * force a redundant round-trip for data the client already holds. A's version LIST (`recipeAVersions`) still
 * goes stale — a PATCH always records a new version row, and the response carries no version-list shape to
 * write through — alongside every recipe list, the search cache, and every collection embed (DA2, a
 * `CollectionWithRecipes.recipes` entry embeds the full `Recipe`, and the client has no index of which
 * collections embed A).
 */
const UPDATE_PROBES: readonly CacheProbeName[] = [
    'recipeAVersions',
    'recipeList',
    'recipeSearch',
    ...ALL_COLLECTION_PROBES,
];

/**
 * DA3 — what `PATCH .../visibility` on recipe A stales. Same shape as {@link UPDATE_PROBES} MINUS
 * `recipeAVersions`: confirmed against the server DAL (`recipes.dal.ts` `setVisibility`) that a visibility
 * flip is a pure single-column metadata UPDATE with no `recipe_versions` insert and no `currentVersion`
 * bump, so — unlike a content edit or a restore — it records no new version for the list to reflect.
 */
const VISIBILITY_PROBES: readonly CacheProbeName[] = ['recipeList', 'recipeSearch', ...ALL_COLLECTION_PROBES];

/**
 * DA3 — what restoring a version of recipe A stales. A restore is server-side a full content rewrite off the
 * snapshot AND it records a new version row, so its shape is identical to {@link UPDATE_PROBES}: A's own
 * detail/photos stay valid (write-through from `data.recipe`), `recipeAVersions` goes stale (the restore
 * minted a new version), and every list/search/collection-embed goes stale exactly as an update does. Recipe
 * B is untouched — a restore is scoped to one recipe, so unlike the blanket `recipes` writes above this one
 * stays keyed off the mutation's variables.
 */
const RESTORE_PROBES: readonly CacheProbeName[] = UPDATE_PROBES;

/**
 * DA3 — what cloning a recipe stales. The clone mints a NEW recipe (its detail is written through under the
 * CLONE's own id, not any seeded probe), so no existing recipe/collection probe goes stale: only the caller's
 * recipe lists and search need to reflect the new row. A fresh clone is a member of no collection, so
 * (unlike update/delete/visibility) `collections` is deliberately excluded.
 */
const CLONE_PROBES: readonly CacheProbeName[] = ['recipeList', 'recipeSearch'];

/**
 * What rating recipe A stales — identical shape to a restore, and for the same reason: a rating changes
 * the recipe's trigger-maintained `averageRating` / `ratingCount`, which are `Recipe` metadata rendered
 * on A's detail, on every list row, AND on every search result. So it stales A's own subtree, every list,
 * and search — keyed off the mutation's variables, so recipe B (untouched) stays cached.
 */
const RATING_PROBES: readonly CacheProbeName[] = [
    ...RECIPE_A_SUBTREE_PROBES,
    'recipeList',
    'recipeSearch',
    // DA2 — a rating changes `averageRating`/`ratingCount`, which every collection embed of recipe A renders.
    ...ALL_COLLECTION_PROBES,
];

/**
 * What a photo write (confirm / delete / reorder) on recipe A stales — the SAME shape as a restore/rating,
 * and for a concrete reason: a photo write changes the recipe's `coverPhotoUrl` (the lowest-sort-order
 * photo, resolved on projection), and that cover is rendered on A's detail, on every recipe LIST row (the
 * list projection resolves it so a card paints without an N+1 fetch), AND on every SEARCH result (a search
 * row embeds the full `Recipe`). So a photo write stales A's own subtree (its embedded `photos` + detail),
 * every list, and search — keyed off the mutation's variables, so recipe B (untouched) stays cached. A
 * deleted or reordered cover left on the grid/search is a genuine broken-image staleness bug, not a cost.
 */
const PHOTO_PROBES: readonly CacheProbeName[] = [
    ...RECIPE_A_SUBTREE_PROBES,
    'recipeList',
    'recipeSearch',
    // DA2 — a photo write changes `coverPhotoUrl`, which every collection embed of recipe A renders.
    ...ALL_COLLECTION_PROBES,
];

/**
 * A minimal valid `CreateRecipeInput`. The times are required by the contract, so they are spelled out
 * here rather than left off — the hook forwards whatever it is handed, and the input must typecheck.
 *
 * @param overrides - Fields to replace on the draft.
 * @returns A complete create-recipe draft.
 */
function makeCreateInput(overrides: Partial<CreateRecipeInput> = {}): CreateRecipeInput {
    return {
        title: 'Tomato Soup',
        ingredients: [],
        steps: [],
        servings: 4,
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
        totalTimeMinutes: 30,
        ...overrides,
    };
}

/**
 * Render a mutation hook against a probe-seeded cache.
 *
 * @param hook - The mutation hook to render.
 * @returns The harness plus a `probes()` reader for the invalidated set.
 * @sideEffect Mounts React and seeds the query cache.
 */
function renderMutation<TResult>(hook: () => TResult) {
    const client = makeGuardedClient();
    const queryClient = makeTestQueryClient();
    seedCacheProbes(queryClient);
    const harness = renderRecipeHook(hook, { client, queryClient });

    return { ...harness, probes: () => invalidatedProbes(queryClient) };
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useCreateRecipe', () => {
    it('creates the recipe through the client and returns the created detail', async () => {
        const created = makeRecipeDetail({ id: 'rec_new' });
        const { result, client } = renderMutation(() => useCreateRecipe());
        const createRecipe = vi.spyOn(client, 'createRecipe').mockResolvedValue(created);
        const input = makeCreateInput();

        act(() => result.current.mutate(input));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(createRecipe).toHaveBeenCalledWith(input);
        expect(result.current.data).toEqual(created);
    });

    it('invalidates every recipe query and the search cache — the new recipe must appear in both', async () => {
        const { result, client, probes } = renderMutation(() => useCreateRecipe());
        vi.spyOn(client, 'createRecipe').mockResolvedValue(makeRecipeDetail());

        act(() => result.current.mutate(makeCreateInput({ title: 'X' })));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual(expectedProbes(RECIPE_WRITE_PROBES));
    });

    it('surfaces a validation failure and invalidates nothing', async () => {
        const error = new BadRequestError('Title is required', 'VALIDATION_ERROR');
        const { result, client, probes } = renderMutation(() => useCreateRecipe());
        vi.spyOn(client, 'createRecipe').mockRejectedValue(error);

        act(() => result.current.mutate(makeCreateInput({ title: '' })));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
        expect(probes()).toEqual([]);
    });
});

describe('useUpdateRecipe', () => {
    it('updates through the client with the id and the update body', async () => {
        const updated = makeRecipeDetail({ id: PROBE_RECIPE_ID, title: 'New', currentVersion: 6 });
        const { result, client } = renderMutation(() => useUpdateRecipe());
        const updateRecipe = vi.spyOn(client, 'updateRecipe').mockResolvedValue(updated);
        const input = { expectedVersion: 5, title: 'New' };

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, input }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(updateRecipe).toHaveBeenCalledWith(PROBE_RECIPE_ID, input);
        expect(result.current.data).toEqual(updated);
    });

    it('invalidates the version list, every recipe list, search, and every collection — but NOT the detail (DA3)', async () => {
        const { result, client, probes } = renderMutation(() => useUpdateRecipe());
        vi.spyOn(client, 'updateRecipe').mockResolvedValue(makeRecipeDetail({ id: PROBE_RECIPE_ID }));

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, input: { expectedVersion: 1, title: 'New' } }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual(expectedProbes(UPDATE_PROBES));
    });

    it('writes the update response through to the detail cache instead of invalidating it (DA3, no refetch round-trip)', async () => {
        const updated = makeRecipeDetail({ id: PROBE_RECIPE_ID, title: 'New', currentVersion: 6 });
        const { result, client, queryClient } = renderMutation(() => useUpdateRecipe());
        vi.spyOn(client, 'updateRecipe').mockResolvedValue(updated);

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, input: { expectedVersion: 5, title: 'New' } }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(queryClient.getQueryData(recipeServiceKeys.recipe(PROBE_RECIPE_ID))).toEqual(updated);
    });

    it('surfaces a 409 version conflict and invalidates nothing (the stale write must not evict cache)', async () => {
        const error = new VersionConflictError(6, 1);
        const { result, client, probes } = renderMutation(() => useUpdateRecipe());
        vi.spyOn(client, 'updateRecipe').mockRejectedValue(error);

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, input: { expectedVersion: 1, title: 'New' } }));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
        expect(probes()).toEqual([]);
    });
});

describe('useDeleteRecipe', () => {
    it('deletes through the client with the id', async () => {
        const { result, client } = renderMutation(() => useDeleteRecipe());
        const deleteRecipe = vi.spyOn(client, 'deleteRecipe').mockResolvedValue(undefined);

        act(() => result.current.mutate(PROBE_RECIPE_ID));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(deleteRecipe).toHaveBeenCalledWith(PROBE_RECIPE_ID);
    });

    it('invalidates every recipe query and the search cache — the deleted recipe must leave both', async () => {
        // A tombstoned recipe is excluded from the search read too, so leaving `recipeSearch` valid would
        // keep a mounted search screen offering a result that now 404s when opened.
        const { result, client, probes } = renderMutation(() => useDeleteRecipe());
        vi.spyOn(client, 'deleteRecipe').mockResolvedValue(undefined);

        act(() => result.current.mutate(PROBE_RECIPE_ID));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual(expectedProbes(RECIPE_EMBED_WRITE_PROBES));
    });

    it('stales collection caches so a deleted recipe leaves its collections (DA2)', async () => {
        const { result, client, probes } = renderMutation(() => useDeleteRecipe());
        vi.spyOn(client, 'deleteRecipe').mockResolvedValue(undefined);

        act(() => result.current.mutate(PROBE_RECIPE_ID));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // DA2 — a soft-deleted recipe is embedded in CollectionWithRecipes.recipes; the write must stale the
        // collections prefix so the vanished member does not linger on a mounted collection view.
        expect(probes()).toContain('collectionA');
        expect(probes()).toContain('collectionList');
    });

    it('surfaces a 403 when the caller is not the owner, and invalidates nothing', async () => {
        const error = new ForbiddenError('Not the owner', 'NOT_OWNER');
        const { result, client, probes } = renderMutation(() => useDeleteRecipe());
        vi.spyOn(client, 'deleteRecipe').mockRejectedValue(error);

        act(() => result.current.mutate(PROBE_RECIPE_ID));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
        expect(probes()).toEqual([]);
    });
});

describe('useCloneRecipe', () => {
    it('clones through the client with the source recipe id and returns the clone', async () => {
        const clone = makeRecipeDetail({ id: 'rec_clone', clonedFromId: 'rec_src' });
        const { result, client } = renderMutation(() => useCloneRecipe());
        const cloneRecipe = vi.spyOn(client, 'cloneRecipe').mockResolvedValue(clone);

        act(() => result.current.mutate('rec_src'));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(cloneRecipe).toHaveBeenCalledWith('rec_src');
        expect(result.current.data).toEqual(clone);
    });

    it("invalidates the caller's recipe lists and search — the clone must appear in both — but no other recipe or collection (DA3)", async () => {
        // The discovery screen clones straight from a rendered search result (`RecipeDiscoveryContainer`
        // composes `useSearchRecipes` + `useCloneRecipe`), so the search cache is provably live at the
        // moment this mutation succeeds — the one place staleness is guaranteed to be on screen. A fresh
        // clone is a member of no collection and changes no existing recipe, so `collections` and every
        // existing-recipe probe (A/B/versions/photos) must stay valid.
        const { result, client, probes } = renderMutation(() => useCloneRecipe());
        vi.spyOn(client, 'cloneRecipe').mockResolvedValue(makeRecipeDetail({ id: 'rec_clone' }));

        act(() => result.current.mutate('rec_src'));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual(expectedProbes(CLONE_PROBES));
    });

    it("writes the clone's detail through to its OWN detail cache (DA3, no refetch round-trip)", async () => {
        const clone = makeRecipeDetail({ id: 'rec_clone', clonedFromId: 'rec_src' });
        const { result, client, queryClient } = renderMutation(() => useCloneRecipe());
        vi.spyOn(client, 'cloneRecipe').mockResolvedValue(clone);

        act(() => result.current.mutate('rec_src'));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(queryClient.getQueryData(recipeServiceKeys.recipe('rec_clone'))).toEqual(clone);
    });

    it('surfaces a 404 for a missing/private source recipe and invalidates nothing', async () => {
        const error = new NotFoundError('Recipe not found', 'NOT_FOUND');
        const { result, client, probes } = renderMutation(() => useCloneRecipe());
        vi.spyOn(client, 'cloneRecipe').mockRejectedValue(error);

        act(() => result.current.mutate('rec_missing'));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
        expect(probes()).toEqual([]);
    });
});

describe('useSetRecipeVisibility', () => {
    it('sets visibility through the client with the id and the new visibility', async () => {
        const updated = makeRecipeDetail({ id: PROBE_RECIPE_ID, visibility: 'public' });
        const { result, client } = renderMutation(() => useSetRecipeVisibility());
        const setRecipeVisibility = vi.spyOn(client, 'setRecipeVisibility').mockResolvedValue(updated);

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, visibility: 'public' }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(setRecipeVisibility).toHaveBeenCalledWith(PROBE_RECIPE_ID, 'public');
        expect(result.current.data).toEqual(updated);
    });

    it('invalidates every recipe list, search, and every collection — but NOT the detail or the version list (DA3)', async () => {
        // Search rows are `Recipe` metadata, which carries `visibility` — and the search read is scoped
        // `public OR owned`, so a visibility flip changes both what a result renders and who matches it. No
        // `recipeAVersions` here: confirmed against the server DAL that a visibility flip is a pure
        // metadata UPDATE with no `recipe_versions` insert, unlike a content edit or a restore.
        const { result, client, probes } = renderMutation(() => useSetRecipeVisibility());
        vi.spyOn(client, 'setRecipeVisibility').mockResolvedValue(makeRecipeDetail({ id: PROBE_RECIPE_ID }));

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, visibility: 'private' }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual(expectedProbes(VISIBILITY_PROBES));
    });

    it('writes the visibility response through to the detail cache instead of invalidating it (DA3, no refetch round-trip)', async () => {
        const updated = makeRecipeDetail({ id: PROBE_RECIPE_ID, visibility: 'public' });
        const { result, client, queryClient } = renderMutation(() => useSetRecipeVisibility());
        vi.spyOn(client, 'setRecipeVisibility').mockResolvedValue(updated);

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, visibility: 'public' }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(queryClient.getQueryData(recipeServiceKeys.recipe(PROBE_RECIPE_ID))).toEqual(updated);
    });

    it('surfaces a 403 (free tier cannot make a recipe private) and invalidates nothing', async () => {
        const error = new ForbiddenError('Premium required', 'PREMIUM_REQUIRED');
        const { result, client, probes } = renderMutation(() => useSetRecipeVisibility());
        vi.spyOn(client, 'setRecipeVisibility').mockRejectedValue(error);

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, visibility: 'private' }));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
        expect(probes()).toEqual([]);
    });
});

describe('useRestoreRecipeVersion', () => {
    it('restores through the client with BOTH the id and the version number, in order', async () => {
        const restored = makeRestoreVersionResponse({ restoredFromVersion: 2, currentVersion: 7 });
        const { result, client } = renderMutation(() => useRestoreRecipeVersion());
        const restoreRecipeVersion = vi.spyOn(client, 'restoreRecipeVersion').mockResolvedValue(restored);

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, versionNumber: 2 }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(restoreRecipeVersion).toHaveBeenCalledWith(PROBE_RECIPE_ID, 2);
        expect(result.current.data).toEqual(restored);
    });

    it("invalidates the restored recipe's version list, every recipe list, and search — but NOT the detail or other recipes (DA3)", async () => {
        // A restore is server-side a full `recipes.update` off the snapshot: it rewrites `title` and bumps
        // `currentVersion` (both rendered by list rows), records a new version, and rebuilds the row's
        // search text. The detail itself is write-through (`data.recipe`), not invalidated.
        const { result, client, probes } = renderMutation(() => useRestoreRecipeVersion());
        vi.spyOn(client, 'restoreRecipeVersion').mockResolvedValue(makeRestoreVersionResponse());

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, versionNumber: 2 }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual(expectedProbes(RESTORE_PROBES));
    });

    it('writes the restored detail (data.recipe) through to the detail cache (DA3, no refetch round-trip)', async () => {
        const restored = makeRestoreVersionResponse({
            recipe: makeRecipeDetail({ id: PROBE_RECIPE_ID, title: 'Restored Title', currentVersion: 7 }),
            restoredFromVersion: 2,
            currentVersion: 7,
        });
        const { result, client, queryClient } = renderMutation(() => useRestoreRecipeVersion());
        vi.spyOn(client, 'restoreRecipeVersion').mockResolvedValue(restored);

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, versionNumber: 2 }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(queryClient.getQueryData(recipeServiceKeys.recipe(PROBE_RECIPE_ID))).toEqual(restored.recipe);
    });

    it('keys the invalidation off the variables, so restoring recipe A leaves recipe B cached', async () => {
        const { result, client, probes } = renderMutation(() => useRestoreRecipeVersion());
        vi.spyOn(client, 'restoreRecipeVersion').mockResolvedValue(makeRestoreVersionResponse());

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, versionNumber: 2 }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).not.toContain('recipeB');
    });

    it('surfaces a 404 for a missing version and invalidates nothing', async () => {
        const error = new NotFoundError('Version not found', 'NOT_FOUND');
        const { result, client, probes } = renderMutation(() => useRestoreRecipeVersion());
        vi.spyOn(client, 'restoreRecipeVersion').mockRejectedValue(error);

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, versionNumber: 99 }));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
        expect(probes()).toEqual([]);
    });
});

describe('useSetRecipeRating', () => {
    it('rates through the client with the id and the { stars } body, returning the refreshed detail', async () => {
        const rated = makeRecipeDetail({ id: PROBE_RECIPE_ID, ratingCount: 1, averageRating: 4 });
        const { result, client } = renderMutation(() => useSetRecipeRating());
        const setRecipeRating = vi.spyOn(client, 'setRecipeRating').mockResolvedValue(rated);

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, input: { stars: 4 } }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(setRecipeRating).toHaveBeenCalledWith(PROBE_RECIPE_ID, { stars: 4 });
        expect(result.current.data).toEqual(rated);
    });

    it("invalidates the rated recipe's subtree, every recipe list, and search — but NOT other recipes", async () => {
        // averageRating/ratingCount are `Recipe` metadata rendered on the detail, list rows, AND search
        // results, so leaving any of the three valid strands them on the pre-rating score. Search sits
        // under its own namespace outside `recipes`, so it takes the explicit `recipeSearches` call.
        const { result, client, probes } = renderMutation(() => useSetRecipeRating());
        vi.spyOn(client, 'setRecipeRating').mockResolvedValue(makeRecipeDetail({ id: PROBE_RECIPE_ID }));

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, input: { stars: 5 } }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual(expectedProbes(RATING_PROBES));
    });

    it('keys the invalidation off the variables, so rating recipe A leaves recipe B cached', async () => {
        const { result, client, probes } = renderMutation(() => useSetRecipeRating());
        vi.spyOn(client, 'setRecipeRating').mockResolvedValue(makeRecipeDetail({ id: PROBE_RECIPE_ID }));

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, input: { stars: 5 } }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).not.toContain('recipeB');
    });

    it('invalidates the search namespace explicitly (a new score must refresh in search results)', async () => {
        // Guards the exact prior bug: `recipeSearches` lives OUTSIDE the `recipes` prefix, so a rating
        // write must name it — invalidating only `recipe(id)` + `recipeLists` would leave search stale.
        const { result, client, probes } = renderMutation(() => useSetRecipeRating());
        vi.spyOn(client, 'setRecipeRating').mockResolvedValue(makeRecipeDetail({ id: PROBE_RECIPE_ID }));

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, input: { stars: 5 } }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toContain('recipeSearch');
    });

    it('surfaces a 403 (rating your own recipe), rolls back the optimistic write, and invalidates nothing', async () => {
        // A failed write must not evict good cache (the pre-existing repo contract), and — critically for
        // rating — must not force a refetch of `recipe(id)` at all: both detail containers render
        // `query.isError` BEFORE `query.data`, so an invalidation-triggered refetch that ALSO fails (e.g. the
        // recipe became unreadable) would discard the whole detail page for the not-found screen. The rollback
        // above is the ONLY reconciliation on failure; there is no round-trip to the server that could cascade.
        const error = new ForbiddenError('Cannot rate your own recipe', 'CANNOT_RATE_OWN_RECIPE');
        const { result, client, queryClient, probes } = renderMutation(() => useSetRecipeRating());
        queryClient.setQueryData(
            recipeServiceKeys.recipe(PROBE_RECIPE_ID),
            makeRecipeDetail({ id: PROBE_RECIPE_ID, viewerRating: undefined }),
        );
        vi.spyOn(client, 'setRecipeRating').mockRejectedValue(error);

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, input: { stars: 5 } }));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
        expect(
            queryClient.getQueryData<RecipeDetail>(recipeServiceKeys.recipe(PROBE_RECIPE_ID))?.viewerRating,
        ).toBeUndefined();
        expect(probes()).toEqual([]);
    });

    it('surfaces a 404 (rating a recipe the caller cannot see), rolls back the optimistic write, and invalidates nothing', async () => {
        // Sc9 — the recipe became unreadable between page-load and the rating tap. Invalidating `recipe(id)`
        // here would trigger a refetch that also 404s, cascading past the inline rating banner to discard the
        // entire detail page (ingredients, steps, owner actions, version links). The rollback restores local
        // truth without a round-trip, so nothing is invalidated.
        const error = new NotFoundError('Recipe not found', 'RECIPE_NOT_FOUND');
        const { result, client, queryClient, probes } = renderMutation(() => useSetRecipeRating());
        queryClient.setQueryData(
            recipeServiceKeys.recipe(PROBE_RECIPE_ID),
            makeRecipeDetail({ id: PROBE_RECIPE_ID, viewerRating: undefined }),
        );
        vi.spyOn(client, 'setRecipeRating').mockRejectedValue(error);

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, input: { stars: 5 } }));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
        expect(
            queryClient.getQueryData<RecipeDetail>(recipeServiceKeys.recipe(PROBE_RECIPE_ID))?.viewerRating,
        ).toBeUndefined();
        expect(probes()).toEqual([]);
    });

    describe('optimistic update (DA4)', () => {
        it('sets the cached viewerRating immediately, before the write resolves', async () => {
            const { result, client, queryClient } = renderMutation(() => useSetRecipeRating());
            queryClient.setQueryData(
                recipeServiceKeys.recipe(PROBE_RECIPE_ID),
                makeRecipeDetail({ id: PROBE_RECIPE_ID, viewerRating: undefined }),
            );
            let resolveSetRecipeRating: (value: RecipeDetail) => void = () => {
                throw new Error('resolveSetRecipeRating was not assigned');
            };
            const pending = new Promise<RecipeDetail>((resolve) => {
                resolveSetRecipeRating = resolve;
            });
            vi.spyOn(client, 'setRecipeRating').mockReturnValue(pending);

            act(() => result.current.mutate({ id: PROBE_RECIPE_ID, input: { stars: 4 } }));

            // The write has not resolved yet, but the cache already reflects the tapped value.
            await waitFor(() =>
                expect(
                    queryClient.getQueryData<RecipeDetail>(recipeServiceKeys.recipe(PROBE_RECIPE_ID))?.viewerRating,
                ).toBe(4),
            );
            expect(result.current.isSuccess).toBe(false);

            resolveSetRecipeRating(makeRecipeDetail({ id: PROBE_RECIPE_ID, viewerRating: 4 }));
            await waitFor(() => expect(result.current.isSuccess).toBe(true));

            expect(
                queryClient.getQueryData<RecipeDetail>(recipeServiceKeys.recipe(PROBE_RECIPE_ID))?.viewerRating,
            ).toBe(4);
        });

        it('rolls back the cached viewerRating to the pre-mutation snapshot when the write rejects', async () => {
            const { result, client, queryClient } = renderMutation(() => useSetRecipeRating());
            queryClient.setQueryData(
                recipeServiceKeys.recipe(PROBE_RECIPE_ID),
                makeRecipeDetail({ id: PROBE_RECIPE_ID, viewerRating: 2 }),
            );
            vi.spyOn(client, 'setRecipeRating').mockRejectedValue(
                new BadRequestError('Invalid stars', 'VALIDATION_ERROR'),
            );

            act(() => result.current.mutate({ id: PROBE_RECIPE_ID, input: { stars: 5 } }));
            await waitFor(() => expect(result.current.isError).toBe(true));

            // Rolls back to the snapshot taken before the optimistic write (2, not undefined) — a
            // synchronously-rejecting mock collapses the optimistic window to a single microtask, so the
            // observable end state is what this test pins; the transient optimistic write is covered above.
            expect(
                queryClient.getQueryData<RecipeDetail>(recipeServiceKeys.recipe(PROBE_RECIPE_ID))?.viewerRating,
            ).toBe(2);
        });
    });
});

describe('useDeleteRecipeRating', () => {
    it('deletes the rating through the client with the id (idempotent — resolves void)', async () => {
        const { result, client } = renderMutation(() => useDeleteRecipeRating());
        const deleteRecipeRating = vi.spyOn(client, 'deleteRecipeRating').mockResolvedValue(undefined);

        act(() => result.current.mutate(PROBE_RECIPE_ID));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(deleteRecipeRating).toHaveBeenCalledWith(PROBE_RECIPE_ID);
    });

    it("invalidates the recipe's subtree, every list, and search (removing a rating re-derives the aggregate)", async () => {
        const { result, client, probes } = renderMutation(() => useDeleteRecipeRating());
        vi.spyOn(client, 'deleteRecipeRating').mockResolvedValue(undefined);

        act(() => result.current.mutate(PROBE_RECIPE_ID));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual(expectedProbes(RATING_PROBES));
    });

    it('surfaces a 404, rolls back the optimistic removal, and invalidates nothing', async () => {
        // Same Sc9 cascade risk as `useSetRecipeRating`'s failure tests above: invalidating `recipe(id)` on
        // a failed removal would refetch straight into another 404 and blow away the whole detail page.
        const error = new NotFoundError('Recipe not found', 'RECIPE_NOT_FOUND');
        const { result, client, queryClient, probes } = renderMutation(() => useDeleteRecipeRating());
        queryClient.setQueryData(
            recipeServiceKeys.recipe(PROBE_RECIPE_ID),
            makeRecipeDetail({ id: PROBE_RECIPE_ID, viewerRating: 3 }),
        );
        vi.spyOn(client, 'deleteRecipeRating').mockRejectedValue(error);

        act(() => result.current.mutate(PROBE_RECIPE_ID));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
        expect(queryClient.getQueryData<RecipeDetail>(recipeServiceKeys.recipe(PROBE_RECIPE_ID))?.viewerRating).toBe(3);
        expect(probes()).toEqual([]);
    });

    describe('optimistic update (DA4)', () => {
        it('clears the cached viewerRating immediately, before the removal resolves', async () => {
            const { result, client, queryClient } = renderMutation(() => useDeleteRecipeRating());
            queryClient.setQueryData(
                recipeServiceKeys.recipe(PROBE_RECIPE_ID),
                makeRecipeDetail({ id: PROBE_RECIPE_ID, viewerRating: 4 }),
            );
            let resolveDeleteRecipeRating: () => void = () => {
                throw new Error('resolveDeleteRecipeRating was not assigned');
            };
            const pending = new Promise<void>((resolve) => {
                resolveDeleteRecipeRating = resolve;
            });
            vi.spyOn(client, 'deleteRecipeRating').mockReturnValue(pending);

            act(() => result.current.mutate(PROBE_RECIPE_ID));

            await waitFor(() =>
                expect(
                    queryClient.getQueryData<RecipeDetail>(recipeServiceKeys.recipe(PROBE_RECIPE_ID))?.viewerRating,
                ).toBeUndefined(),
            );
            expect(result.current.isSuccess).toBe(false);

            resolveDeleteRecipeRating();
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
        });

        it('rolls back the cached viewerRating to the pre-mutation snapshot when the removal rejects', async () => {
            const { result, client, queryClient } = renderMutation(() => useDeleteRecipeRating());
            queryClient.setQueryData(
                recipeServiceKeys.recipe(PROBE_RECIPE_ID),
                makeRecipeDetail({ id: PROBE_RECIPE_ID, viewerRating: 4 }),
            );
            vi.spyOn(client, 'deleteRecipeRating').mockRejectedValue(new NotFoundError('Recipe not found'));

            act(() => result.current.mutate(PROBE_RECIPE_ID));
            await waitFor(() => expect(result.current.isError).toBe(true));

            // Rolls back to the snapshot taken before the optimistic clear (4, not undefined) — a
            // synchronously-rejecting mock collapses the optimistic window to a single microtask, so the
            // observable end state is what this test pins; the transient optimistic clear is covered above.
            expect(
                queryClient.getQueryData<RecipeDetail>(recipeServiceKeys.recipe(PROBE_RECIPE_ID))?.viewerRating,
            ).toBe(4);
        });
    });
});

describe('useCreateIngredient', () => {
    it('creates the freeform ingredient through the client with the name', async () => {
        const created = makeIngredient({ id: 'ing_new', name: 'Sumac', isUserEntered: true });
        const { result, client } = renderMutation(() => useCreateIngredient());
        const createIngredient = vi.spyOn(client, 'createIngredient').mockResolvedValue(created);

        act(() => result.current.mutate('Sumac'));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(createIngredient).toHaveBeenCalledWith('Sumac');
        expect(result.current.data).toEqual(created);
    });

    it('invalidates nothing — a new ingredient belongs to no cached query yet', async () => {
        const { result, client, probes } = renderMutation(() => useCreateIngredient());
        vi.spyOn(client, 'createIngredient').mockResolvedValue(makeIngredient());

        act(() => result.current.mutate('Sumac'));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual([]);
    });

    it('surfaces a validation failure', async () => {
        const error = new BadRequestError('Name is required', 'VALIDATION_ERROR');
        const { result, client } = renderMutation(() => useCreateIngredient());
        vi.spyOn(client, 'createIngredient').mockRejectedValue(error);

        act(() => result.current.mutate(''));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
    });
});

describe('useCreatePhotoUploadUrl', () => {
    it('mints the presigned URL through the client with the recipe id and the request', async () => {
        const response = makeUploadUrlResponse();
        const { result, client } = renderMutation(() => useCreatePhotoUploadUrl());
        const createPhotoUploadUrl = vi.spyOn(client, 'createPhotoUploadUrl').mockResolvedValue(response);
        const request = { fileName: 'soup.jpg', contentType: 'image/jpeg', fileSize: 1024 };

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, request }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(createPhotoUploadUrl).toHaveBeenCalledWith(PROBE_RECIPE_ID, request);
        expect(result.current.data).toEqual(response);
    });

    it('invalidates nothing — minting a URL changes no server state', async () => {
        const { result, client, probes } = renderMutation(() => useCreatePhotoUploadUrl());
        vi.spyOn(client, 'createPhotoUploadUrl').mockResolvedValue(makeUploadUrlResponse());

        act(() =>
            result.current.mutate({
                id: PROBE_RECIPE_ID,
                request: { fileName: 'a.jpg', contentType: 'image/jpeg', fileSize: 1 },
            }),
        );
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual([]);
    });

    it('surfaces a rejected file (bad type/size) as an error', async () => {
        const error = new BadRequestError('Unsupported content type', 'VALIDATION_ERROR');
        const { result, client } = renderMutation(() => useCreatePhotoUploadUrl());
        vi.spyOn(client, 'createPhotoUploadUrl').mockRejectedValue(error);

        act(() =>
            result.current.mutate({
                id: PROBE_RECIPE_ID,
                request: { fileName: 'a.exe', contentType: 'application/octet-stream', fileSize: 1 },
            }),
        );
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
    });
});

describe('useConfirmPhotoUpload', () => {
    it('confirms through the client with the recipe id and the confirm request', async () => {
        const photo = makeRecipePhoto();
        const { result, client } = renderMutation(() => useConfirmPhotoUpload());
        const confirmPhotoUpload = vi.spyOn(client, 'confirmPhotoUpload').mockResolvedValue(photo);
        const request = { key: 'recipes/rec_a/pending/x.jpg', contentType: 'image/jpeg' };

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, request }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(confirmPhotoUpload).toHaveBeenCalledWith(PROBE_RECIPE_ID, request);
        expect(result.current.data).toEqual(photo);
    });

    it("invalidates the recipe's subtree, every list, and search — a confirmed photo can become the cover", async () => {
        // Confirming an upload can add the first (or a lower-sorted) photo, which becomes the recipe's
        // `coverPhotoUrl` — a field the LIST and SEARCH projections both render. Staling only the subtree
        // would leave the library grid and search results painting the pre-confirm cover (or none).
        const { result, client, probes } = renderMutation(() => useConfirmPhotoUpload());
        vi.spyOn(client, 'confirmPhotoUpload').mockResolvedValue(makeRecipePhoto());

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, request: { key: 'k', contentType: 'image/jpeg' } }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual(expectedProbes(PHOTO_PROBES));
    });

    it('surfaces a 404 for an unknown upload key and invalidates nothing', async () => {
        const error = new NotFoundError('Upload not found', 'NOT_FOUND');
        const { result, client, probes } = renderMutation(() => useConfirmPhotoUpload());
        vi.spyOn(client, 'confirmPhotoUpload').mockRejectedValue(error);

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, request: { key: 'k', contentType: 'image/jpeg' } }));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
        expect(probes()).toEqual([]);
    });
});

describe('useDeleteRecipePhoto', () => {
    it('deletes through the client with BOTH the recipe id and the photo id, in order', async () => {
        const { result, client } = renderMutation(() => useDeleteRecipePhoto());
        const deleteRecipePhoto = vi.spyOn(client, 'deleteRecipePhoto').mockResolvedValue(undefined);

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, photoId: 'pho_9' }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(deleteRecipePhoto).toHaveBeenCalledWith(PROBE_RECIPE_ID, 'pho_9');
    });

    it("invalidates the recipe's subtree, every list, and search — deleting the cover changes what they render", async () => {
        // `RecipeDetail.photos` is embedded, so a deleted photo lingers on an open detail unless the detail
        // is invalidated. It also lingers on the library grid and in search results: deleting the cover
        // promotes the next photo (or leaves none), and both the LIST and SEARCH projections render that
        // `coverPhotoUrl`. A stale/deleted cover URL there paints a broken (CDN-404) image, so both stale.
        const { result, client, probes } = renderMutation(() => useDeleteRecipePhoto());
        vi.spyOn(client, 'deleteRecipePhoto').mockResolvedValue(undefined);

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, photoId: 'pho_9' }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual(expectedProbes(PHOTO_PROBES));
    });

    it('surfaces a 403 and invalidates nothing', async () => {
        const error = new ForbiddenError('Not the owner', 'NOT_OWNER');
        const { result, client, probes } = renderMutation(() => useDeleteRecipePhoto());
        vi.spyOn(client, 'deleteRecipePhoto').mockRejectedValue(error);

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, photoId: 'pho_9' }));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
        expect(probes()).toEqual([]);
    });
});

describe('useReorderRecipePhotos', () => {
    it('reorders through the client with the recipe id and the ordered photo ids', async () => {
        const reordered = [makeRecipePhoto({ id: 'pho_2', order: 1 }), makeRecipePhoto({ id: 'pho_1', order: 2 })];
        const { result, client } = renderMutation(() => useReorderRecipePhotos());
        const reorderRecipePhotos = vi.spyOn(client, 'reorderRecipePhotos').mockResolvedValue(reordered);

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, photoIds: ['pho_2', 'pho_1'] }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(reorderRecipePhotos).toHaveBeenCalledWith(PROBE_RECIPE_ID, ['pho_2', 'pho_1']);
        expect(result.current.data).toEqual(reordered);
    });

    it("invalidates the recipe's subtree, every list, and search — a reorder is choosing the cover", async () => {
        // A reorder rewrites `RecipeDetail.photos` order (stale on an open detail otherwise) AND, because the
        // cover is the lowest-sort-order photo, it changes `coverPhotoUrl` — the whole point of reordering.
        // That cover renders on the LIST and SEARCH projections, so both go stale alongside the subtree.
        const { result, client, probes } = renderMutation(() => useReorderRecipePhotos());
        vi.spyOn(client, 'reorderRecipePhotos').mockResolvedValue([makeRecipePhoto()]);

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, photoIds: ['pho_2', 'pho_1'] }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual(expectedProbes(PHOTO_PROBES));
    });

    it('surfaces a validation failure (ids not matching the recipe) and invalidates nothing', async () => {
        const error = new BadRequestError('photoIds must cover the recipe', 'VALIDATION_ERROR');
        const { result, client, probes } = renderMutation(() => useReorderRecipePhotos());
        vi.spyOn(client, 'reorderRecipePhotos').mockRejectedValue(error);

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, photoIds: [] }));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
        expect(probes()).toEqual([]);
    });
});

describe('invalidateCollections (DA10-b)', () => {
    it('invalidates exactly the collections region, and no recipe region', () => {
        const queryClient = makeTestQueryClient();
        seedCacheProbes(queryClient);

        invalidateCollections(queryClient);

        expect(invalidatedProbes(queryClient)).toEqual(expectedProbes(ALL_COLLECTION_PROBES));
    });

    it('leaves an untouched cache alone when called on an empty client', () => {
        const queryClient = makeTestQueryClient();

        expect(() => invalidateCollections(queryClient)).not.toThrow();
        expect(invalidatedProbes(queryClient)).toEqual([]);
    });
});

describe('useCreateCollection', () => {
    it('creates through the client with the request', async () => {
        const created = makeCollection({ id: 'col_new' });
        const { result, client } = renderMutation(() => useCreateCollection());
        const createCollection = vi.spyOn(client, 'createCollection').mockResolvedValue(created);
        const request = { name: 'Weeknight dinners', visibility: 'private' as const };

        act(() => result.current.mutate(request));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(createCollection).toHaveBeenCalledWith(request);
        expect(result.current.data).toEqual(created);
    });

    it('invalidates every collection query, and no recipe query', async () => {
        const { result, client, probes } = renderMutation(() => useCreateCollection());
        vi.spyOn(client, 'createCollection').mockResolvedValue(makeCollection());

        act(() => result.current.mutate({ name: 'X', visibility: 'private' }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual(expectedProbes(ALL_COLLECTION_PROBES));
    });

    it('surfaces a validation failure and invalidates nothing', async () => {
        const error = new BadRequestError('Name is required', 'VALIDATION_ERROR');
        const { result, client, probes } = renderMutation(() => useCreateCollection());
        vi.spyOn(client, 'createCollection').mockRejectedValue(error);

        act(() => result.current.mutate({ name: '', visibility: 'private' }));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
        expect(probes()).toEqual([]);
    });
});

describe('useUpdateCollection', () => {
    it('updates through the client with the id and the request', async () => {
        const updated = makeCollection({ id: PROBE_COLLECTION_ID, name: 'Renamed' });
        const { result, client } = renderMutation(() => useUpdateCollection());
        const updateCollection = vi.spyOn(client, 'updateCollection').mockResolvedValue(updated);

        act(() => result.current.mutate({ id: PROBE_COLLECTION_ID, request: { name: 'Renamed' } }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(updateCollection).toHaveBeenCalledWith(PROBE_COLLECTION_ID, { name: 'Renamed' });
        expect(result.current.data).toEqual(updated);
    });

    it('invalidates every collection query (the new name must refresh in the list too)', async () => {
        const { result, client, probes } = renderMutation(() => useUpdateCollection());
        vi.spyOn(client, 'updateCollection').mockResolvedValue(makeCollection({ id: PROBE_COLLECTION_ID }));

        act(() => result.current.mutate({ id: PROBE_COLLECTION_ID, request: { name: 'Renamed' } }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual(expectedProbes(ALL_COLLECTION_PROBES));
    });

    it('surfaces a 403 and invalidates nothing', async () => {
        const error = new ForbiddenError('Not the owner', 'NOT_OWNER');
        const { result, client, probes } = renderMutation(() => useUpdateCollection());
        vi.spyOn(client, 'updateCollection').mockRejectedValue(error);

        act(() => result.current.mutate({ id: PROBE_COLLECTION_ID, request: { name: 'Renamed' } }));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
        expect(probes()).toEqual([]);
    });
});

describe('useDeleteCollection', () => {
    it('deletes through the client with the id', async () => {
        const { result, client } = renderMutation(() => useDeleteCollection());
        const deleteCollection = vi.spyOn(client, 'deleteCollection').mockResolvedValue(undefined);

        act(() => result.current.mutate(PROBE_COLLECTION_ID));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(deleteCollection).toHaveBeenCalledWith(PROBE_COLLECTION_ID);
    });

    it('invalidates every collection query', async () => {
        const { result, client, probes } = renderMutation(() => useDeleteCollection());
        vi.spyOn(client, 'deleteCollection').mockResolvedValue(undefined);

        act(() => result.current.mutate(PROBE_COLLECTION_ID));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual(expectedProbes(ALL_COLLECTION_PROBES));
    });

    it('leaves recipe caches untouched — deleting a collection does not delete its recipes', async () => {
        const { result, client, probes } = renderMutation(() => useDeleteCollection());
        vi.spyOn(client, 'deleteCollection').mockResolvedValue(undefined);

        act(() => result.current.mutate(PROBE_COLLECTION_ID));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        for (const recipeProbe of ALL_RECIPE_PROBES) {
            expect(probes()).not.toContain(recipeProbe);
        }
    });

    it('surfaces a 404 and invalidates nothing', async () => {
        const error = new NotFoundError('Collection not found', 'NOT_FOUND');
        const { result, client, probes } = renderMutation(() => useDeleteCollection());
        vi.spyOn(client, 'deleteCollection').mockRejectedValue(error);

        act(() => result.current.mutate(PROBE_COLLECTION_ID));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
        expect(probes()).toEqual([]);
    });
});

describe('useAddRecipeToCollection', () => {
    it('adds through the client with BOTH the collection id and the recipe id, in order', async () => {
        const membership = makeCollectionRecipeMembership();
        const { result, client } = renderMutation(() => useAddRecipeToCollection());
        const addRecipeToCollection = vi.spyOn(client, 'addRecipeToCollection').mockResolvedValue(membership);

        act(() => result.current.mutate({ id: PROBE_COLLECTION_ID, recipeId: PROBE_RECIPE_ID }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(addRecipeToCollection).toHaveBeenCalledWith(PROBE_COLLECTION_ID, PROBE_RECIPE_ID);
        expect(result.current.data).toEqual(membership);
    });

    it('invalidates ONLY that collection — NOT the collection list (confirmed non-bug)', async () => {
        // Deliberate and correct, pinned so it cannot silently widen: the list returns the core `Collection`
        // type, which carries no member-derived data (no count, no membership array, no cover). Membership
        // lives only on the DETAIL (`CollectionWithRecipes.recipes`), staled by `collection(id)`. The list is
        // page/pageSize-only (no activity sort) and a membership insert does not touch `updatedAt`, so its
        // order can't drift either. Invalidating the list would refetch every collection to redraw identical
        // rows. This asserts the collection list probe stays valid — flip it only if a list row grows a count.
        const { result, client, probes } = renderMutation(() => useAddRecipeToCollection());
        vi.spyOn(client, 'addRecipeToCollection').mockResolvedValue(makeCollectionRecipeMembership());

        act(() => result.current.mutate({ id: PROBE_COLLECTION_ID, recipeId: PROBE_RECIPE_ID }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual(expectedProbes(['collectionA']));
    });

    it('surfaces a 404 for an unknown recipe/collection and invalidates nothing', async () => {
        const error = new NotFoundError('Recipe not found', 'NOT_FOUND');
        const { result, client, probes } = renderMutation(() => useAddRecipeToCollection());
        vi.spyOn(client, 'addRecipeToCollection').mockRejectedValue(error);

        act(() => result.current.mutate({ id: PROBE_COLLECTION_ID, recipeId: 'rec_missing' }));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
        expect(probes()).toEqual([]);
    });
});

describe('useRemoveRecipeFromCollection', () => {
    it('removes through the client with BOTH the collection id and the recipe id, in order', async () => {
        const { result, client } = renderMutation(() => useRemoveRecipeFromCollection());
        const removeRecipeFromCollection = vi.spyOn(client, 'removeRecipeFromCollection').mockResolvedValue(undefined);

        act(() => result.current.mutate({ id: PROBE_COLLECTION_ID, recipeId: PROBE_RECIPE_ID }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(removeRecipeFromCollection).toHaveBeenCalledWith(PROBE_COLLECTION_ID, PROBE_RECIPE_ID);
    });

    it('invalidates ONLY that collection', async () => {
        const { result, client, probes } = renderMutation(() => useRemoveRecipeFromCollection());
        vi.spyOn(client, 'removeRecipeFromCollection').mockResolvedValue(undefined);

        act(() => result.current.mutate({ id: PROBE_COLLECTION_ID, recipeId: PROBE_RECIPE_ID }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual(expectedProbes(['collectionA']));
    });

    it('surfaces a 403 and invalidates nothing', async () => {
        const error = new ForbiddenError('Not the owner', 'NOT_OWNER');
        const { result, client, probes } = renderMutation(() => useRemoveRecipeFromCollection());
        vi.spyOn(client, 'removeRecipeFromCollection').mockRejectedValue(error);

        act(() => result.current.mutate({ id: PROBE_COLLECTION_ID, recipeId: PROBE_RECIPE_ID }));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
        expect(probes()).toEqual([]);
    });
});

describe('useCloneCollection', () => {
    it('clones through the client with the source id and the overrides', async () => {
        const clone = makeCollection({ id: 'col_clone', sourceCollectionId: 'col_src' });
        const { result, client } = renderMutation(() => useCloneCollection());
        const cloneCollection = vi.spyOn(client, 'cloneCollection').mockResolvedValue(clone);

        act(() => result.current.mutate({ id: 'col_src', request: { name: 'My copy' } }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(cloneCollection).toHaveBeenCalledWith('col_src', { name: 'My copy' });
        expect(result.current.data).toEqual(clone);
    });

    it('passes an omitted overrides request through as undefined (clone with source defaults)', async () => {
        const { result, client } = renderMutation(() => useCloneCollection());
        const cloneCollection = vi.spyOn(client, 'cloneCollection').mockResolvedValue(makeCollection());

        act(() => result.current.mutate({ id: 'col_src' }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(cloneCollection).toHaveBeenCalledWith('col_src', undefined);
    });

    it("invalidates every collection query — the clone must appear in the caller's list", async () => {
        const { result, client, probes } = renderMutation(() => useCloneCollection());
        vi.spyOn(client, 'cloneCollection').mockResolvedValue(makeCollection({ id: 'col_clone' }));

        act(() => result.current.mutate({ id: 'col_src' }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual(expectedProbes(ALL_COLLECTION_PROBES));
    });

    it('surfaces a 404 for a missing/private source collection and invalidates nothing', async () => {
        const error = new NotFoundError('Collection not found', 'NOT_FOUND');
        const { result, client, probes } = renderMutation(() => useCloneCollection());
        vi.spyOn(client, 'cloneCollection').mockRejectedValue(error);

        act(() => result.current.mutate({ id: 'col_missing' }));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
        expect(probes()).toEqual([]);
    });
});

describe('usePreviewPull', () => {
    it('previews through the client with the collection id and resolves the diff', async () => {
        const diff = makePullDiff();
        const { result, client } = renderMutation(() => usePreviewPull());
        const previewPullFromSource = vi.spyOn(client, 'previewPullFromSource').mockResolvedValue(diff);

        act(() => result.current.mutate(PROBE_COLLECTION_ID));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(previewPullFromSource).toHaveBeenCalledWith(PROBE_COLLECTION_ID);
        expect(result.current.data).toEqual(diff);
    });

    it('is a pure read — invalidates no cache on success', async () => {
        const { result, client, probes } = renderMutation(() => usePreviewPull());
        vi.spyOn(client, 'previewPullFromSource').mockResolvedValue(makePullDiff());

        act(() => result.current.mutate(PROBE_COLLECTION_ID));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual([]);
    });

    it('surfaces a 400 when the collection has no source to preview from', async () => {
        const error = new BadRequestError('Collection is not a clone', 'NOT_A_CLONE');
        const { result, client } = renderMutation(() => usePreviewPull());
        vi.spyOn(client, 'previewPullFromSource').mockRejectedValue(error);

        act(() => result.current.mutate(PROBE_COLLECTION_ID));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
    });
});

describe('usePullCollectionFromSource', () => {
    it('pulls through the client with the collection id and no previewed diff', async () => {
        const response = makePullFromSourceResponse();
        const { result, client } = renderMutation(() => usePullCollectionFromSource());
        const pullCollectionFromSource = vi.spyOn(client, 'pullCollectionFromSource').mockResolvedValue(response);

        act(() => result.current.mutate({ id: PROBE_COLLECTION_ID }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(pullCollectionFromSource).toHaveBeenCalledWith(PROBE_COLLECTION_ID, { previewedDiff: undefined });
        expect(result.current.data).toEqual(response);
    });

    it('forwards an echoed previewedDiff to the client (drift check)', async () => {
        const previewedDiff = makePullDiff();
        const response = makePullFromSourceResponse();
        const { result, client } = renderMutation(() => usePullCollectionFromSource());
        const pullCollectionFromSource = vi.spyOn(client, 'pullCollectionFromSource').mockResolvedValue(response);

        act(() => result.current.mutate({ id: PROBE_COLLECTION_ID, previewedDiff }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(pullCollectionFromSource).toHaveBeenCalledWith(PROBE_COLLECTION_ID, { previewedDiff });
    });

    it('invalidates every collection query', async () => {
        const { result, client, probes } = renderMutation(() => usePullCollectionFromSource());
        vi.spyOn(client, 'pullCollectionFromSource').mockResolvedValue(makePullFromSourceResponse());

        act(() => result.current.mutate({ id: PROBE_COLLECTION_ID }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual(expectedProbes(ALL_COLLECTION_PROBES));
    });

    it('leaves recipe caches untouched (characterizes today: pulled-in recipes do not refresh the library)', async () => {
        const { result, client, probes } = renderMutation(() => usePullCollectionFromSource());
        vi.spyOn(client, 'pullCollectionFromSource').mockResolvedValue(makePullFromSourceResponse());

        act(() => result.current.mutate({ id: PROBE_COLLECTION_ID }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).not.toContain('recipeList');
    });

    it('surfaces a 400 when the collection has no source to pull from, and invalidates nothing', async () => {
        const error = new BadRequestError('Collection is not a clone', 'NOT_A_CLONE');
        const { result, client, probes } = renderMutation(() => usePullCollectionFromSource());
        vi.spyOn(client, 'pullCollectionFromSource').mockRejectedValue(error);

        act(() => result.current.mutate({ id: PROBE_COLLECTION_ID }));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
        expect(probes()).toEqual([]);
    });

    it('surfaces a PULL_DRIFT 409 as a typed PullDriftError (not swallowed) and invalidates nothing', async () => {
        const error = new PullDriftError(makePullDiff({ added: ['rec_9'] }));
        const { result, client, probes } = renderMutation(() => usePullCollectionFromSource());
        vi.spyOn(client, 'pullCollectionFromSource').mockRejectedValue(error);

        act(() => result.current.mutate({ id: PROBE_COLLECTION_ID, previewedDiff: makePullDiff() }));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
        expect((result.current.error as PullDriftError).diff).toEqual(error.diff);
        expect(probes()).toEqual([]);
    });
});

describe('useRequestAccountErasure', () => {
    it('requests erasure through the client with the confirmation request', async () => {
        const accepted = makeErasureAccepted({ status: 'running' });
        const { result, client } = renderMutation(() => useRequestAccountErasure());
        const requestAccountErasure = vi.spyOn(client, 'requestAccountErasure').mockResolvedValue(accepted);
        const request = { confirmationPhrase: 'DELETE MY ACCOUNT' };

        act(() => result.current.mutate(request));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(requestAccountErasure).toHaveBeenCalledWith(request);
        expect(result.current.data).toEqual(accepted);
    });

    it('passes an omitted request through as undefined', async () => {
        const { result, client } = renderMutation(() => useRequestAccountErasure());
        const requestAccountErasure = vi
            .spyOn(client, 'requestAccountErasure')
            .mockResolvedValue(makeErasureAccepted());

        act(() => result.current.mutate(undefined));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(requestAccountErasure).toHaveBeenCalledWith(undefined);
    });

    it('invalidates nothing — erasure is async server-side, so no cache goes stale synchronously', async () => {
        const { result, client, probes } = renderMutation(() => useRequestAccountErasure());
        vi.spyOn(client, 'requestAccountErasure').mockResolvedValue(makeErasureAccepted());

        act(() => result.current.mutate(undefined));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual([]);
    });

    it('surfaces a 410 when the account is already erased', async () => {
        const error = new GoneError('Account already erased', 'ALREADY_ERASED');
        const { result, client } = renderMutation(() => useRequestAccountErasure());
        vi.spyOn(client, 'requestAccountErasure').mockRejectedValue(error);

        act(() => result.current.mutate(undefined));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBe(error);
    });
});

describe('mutation hooks — search cache (cross-cutting characterization)', () => {
    it('a recipe mutation invalidates the recipe-search cache (a created recipe refreshes search)', async () => {
        // `recipeSearch` lives under the `search` namespace, OUTSIDE the `recipes` prefix, so no recipe
        // mutation reached it by accident — each one must name `recipeSearches` explicitly. This is the
        // class-level guard; the per-hook tests above pin the exact set for each of the six.
        const { result, client, probes } = renderMutation(() => useCreateRecipe());
        vi.spyOn(client, 'createRecipe').mockResolvedValue(makeRecipeDetail());

        act(() => result.current.mutate(makeCreateInput({ title: 'X' })));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toContain('recipeSearch');
    });

    it('a photo mutation DOES invalidate the search cache — a search row carries the cover photo', async () => {
        // A search row embeds the full `Recipe`, whose `coverPhotoUrl` is resolved from the lowest-sort-order
        // photo. A photo write can change that cover, so the search result goes stale with it — the same
        // reasoning that makes it stale the recipe LIST. (Earlier this was assumed a no-op "because search
        // rows carry no photo data"; they carry the cover, so the assumption was wrong.)
        const { result, client, probes } = renderMutation(() => useDeleteRecipePhoto());
        vi.spyOn(client, 'deleteRecipePhoto').mockResolvedValue(undefined);

        act(() => result.current.mutate({ id: PROBE_RECIPE_ID, photoId: 'pho_9' }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toContain('recipeSearch');
    });

    it('a collection mutation does NOT invalidate the recipe-search cache', async () => {
        // Collection writes only move membership rows; they create no recipes and change no recipe row.
        const { result, client, probes } = renderMutation(() => useAddRecipeToCollection());
        vi.spyOn(client, 'addRecipeToCollection').mockResolvedValue(makeCollectionRecipeMembership());

        act(() => result.current.mutate({ id: PROBE_COLLECTION_ID, recipeId: PROBE_RECIPE_ID }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).not.toContain('recipeSearch');
    });

    it('creating an ingredient does not invalidate the ingredient-search cache', async () => {
        const { result, client, probes } = renderMutation(() => useCreateIngredient());
        vi.spyOn(client, 'createIngredient').mockResolvedValue(makeIngredient());

        act(() => result.current.mutate('Sumac'));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).not.toContain('ingredientSearch');
    });
});
