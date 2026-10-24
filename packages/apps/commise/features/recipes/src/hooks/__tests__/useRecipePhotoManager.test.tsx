/**
 * Tests for `useRecipePhotoManager` — the ONE recipe-photo manager session both apps' uploaders sit on (web
 * `RecipePhotoUploaderContainer`, mobile `RecipePhotoUploader`). These cases were written FIRST, from the rules the
 * two copies disagreed on:
 *  - a failed delete is said out loud on BOTH platforms (web used to be silent; mobile already spoke);
 *  - "is there room?" is ONE rule, `remainingPhotoSlots`, over the held photos (confirmed + any the caller holds
 *    elsewhere) and the queue's visible items;
 *  - every refusal string comes from `photoMessages`, with the limit derived from the shared constant.
 *
 * `@kitchensink/recipe-service-client/hooks` is doubled (the query + mutations); the REAL `useRecipePhotoUpload`
 * and `useRecipePhotoUploadQueue` run on top, so the admission verdicts are authentic.
 * Moved here: mobile `RecipePhotoUploader.native.test.tsx` "tells the cook how many fit when the queue refuses the
 * pick" (its `queueVerdict` mock cannot reach a hook that composes the queue internally).
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { photosQueryMock, deletePhotoMock, reorderMock } = vi.hoisted(() => ({
    photosQueryMock: vi.fn(),
    deletePhotoMock: vi.fn(),
    reorderMock: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined }),
    useCreatePhotoUploadUrl: () => ({ mutateAsync: vi.fn() }),
    useConfirmPhotoUpload: () => ({ mutateAsync: vi.fn() }),
    useRecipePhotos: photosQueryMock,
    useDeleteRecipePhoto: deletePhotoMock,
    useReorderRecipePhotos: reorderMock,
}));

import { MAX_RECIPE_PHOTO_UPLOAD_BYTES, type RecipePhoto } from '@kitchensink/recipe-core';

import { useRecipePhotoManager } from '../useRecipePhotoManager.js';

const OVER_CAP_FOR_TWO = 'That’s more photos than this recipe can hold — you can add 2 more.';
const REPLACE_AT_CAP = 'Remove a photo first — replacing needs room for the new one.';
const REMOVE_FAILED = 'We couldn’t remove this photo. Please try again.';
const SET_COVER_FAILED = 'We couldn’t make that photo the cover. Please try again.';

const photosOf = (count: number): readonly RecipePhoto[] =>
    Array.from({ length: count }, (_unused, index) => ({
        id: `ph_${index + 1}`,
        recipeId: 'rec_1',
        key: `k${index + 1}`,
        url: `https://cdn.example/${index + 1}.jpg`,
        contentType: 'image/jpeg',
        order: index + 1,
        createdAt: '',
    }));

const fileOf = (name: string, overrides: { fileSize?: number; contentType?: string } = {}) => ({
    blob: new Blob(['x'], { type: 'image/png' }),
    fileName: name,
    contentType: overrides.contentType ?? 'image/png',
    fileSize: overrides.fileSize ?? 5,
});

let deleteMutate: ReturnType<typeof vi.fn>;
let reorderMutate: ReturnType<typeof vi.fn>;
const reorderPending = { current: false };

beforeEach(() => {
    deleteMutate = vi.fn();
    reorderMutate = vi.fn();
    reorderPending.current = false;
    photosQueryMock.mockReset().mockReturnValue({ data: [] });
    deletePhotoMock.mockReset().mockReturnValue({ mutate: deleteMutate, isPending: false, variables: undefined });
    reorderMock.mockReset().mockReturnValue({ mutate: reorderMutate, isPending: reorderPending.current });
});

describe('useRecipePhotoManager — a pick past the cap', () => {
    it('refuses the whole batch and says how many fit', () => {
        photosQueryMock.mockReturnValue({ data: photosOf(5) });
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1' }));

        let verdict: ReturnType<typeof result.current.enqueuePicked> | undefined;
        act(() => {
            verdict = result.current.enqueuePicked(
                Array.from({ length: 8 }, (_unused, index) => fileOf(`f${index}.png`)),
                'add',
            );
        });

        expect(verdict).toEqual({ status: 'overCap', remaining: 5 });
        expect(result.current.queue.items).toHaveLength(0);
        expect(result.current.errorMessage).toBe('That’s more photos than this recipe can hold — you can add 5 more.');
    });

    it('counts photos the caller holds elsewhere (mobile draft picks) against the room', () => {
        photosQueryMock.mockReturnValue({ data: photosOf(6) });
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1', heldElsewhere: 2 }));

        act(() => {
            result.current.enqueuePicked([fileOf('a.png'), fileOf('b.png'), fileOf('c.png')], 'add');
        });

        expect(result.current.errorMessage).toBe(OVER_CAP_FOR_TWO);
    });

    it('says the replace sentence when a REPLACEMENT is turned away', () => {
        photosQueryMock.mockReturnValue({ data: photosOf(10) });
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1' }));

        act(() => {
            result.current.enqueuePicked([fileOf('a.png')], 'replace');
        });

        expect(result.current.errorMessage).toBe(REPLACE_AT_CAP);
    });

    it('clears an earlier refusal when a pick that fits is accepted', () => {
        photosQueryMock.mockReturnValue({ data: photosOf(8) });
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1' }));

        act(() => {
            result.current.enqueuePicked([fileOf('a.png'), fileOf('b.png'), fileOf('c.png')], 'add');
        });
        expect(result.current.errorMessage).toBe(OVER_CAP_FOR_TWO);

        act(() => {
            result.current.enqueuePicked([fileOf('a.png')], 'add');
        });

        expect(result.current.errorMessage).toBeUndefined();
        expect(result.current.queue.items).toHaveLength(1);
    });
});

describe('useRecipePhotoManager — one rule for "is there room to replace?"', () => {
    it('refuses at the cap, with the replace sentence', () => {
        photosQueryMock.mockReturnValue({ data: photosOf(10) });
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1' }));

        let allowed: boolean | undefined;
        act(() => {
            allowed = result.current.beginReplace();
        });

        expect(allowed).toBe(false);
        expect(result.current.errorMessage).toBe(REPLACE_AT_CAP);
    });

    it('allows a replace with one slot free', () => {
        photosQueryMock.mockReturnValue({ data: photosOf(9) });
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1' }));

        let allowed: boolean | undefined;
        act(() => {
            allowed = result.current.beginReplace();
        });

        expect(allowed).toBe(true);
        expect(result.current.errorMessage).toBeUndefined();
    });

    it('counts held-elsewhere photos: 9 confirmed + 1 draft is full', () => {
        photosQueryMock.mockReturnValue({ data: photosOf(9) });
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1', heldElsewhere: 1 }));

        let allowed: boolean | undefined;
        act(() => {
            allowed = result.current.beginReplace();
        });

        expect(allowed).toBe(false);
    });

    it('counts a rejected file against the room too (it still holds a grid cell, as the queue counts it)', () => {
        photosQueryMock.mockReturnValue({ data: photosOf(9) });
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1' }));

        act(() => {
            result.current.enqueuePicked([fileOf('big.png', { fileSize: MAX_RECIPE_PHOTO_UPLOAD_BYTES + 1 })], 'add');
        });
        expect(result.current.queue.items[0]?.status).toBe('failed');

        let allowed: boolean | undefined;
        act(() => {
            allowed = result.current.beginReplace();
        });

        expect(allowed).toBe(false);
    });
});

describe('useRecipePhotoManager — remove', () => {
    it('deletes through the mutation, scoped to the recipe', () => {
        photosQueryMock.mockReturnValue({ data: photosOf(2) });
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1' }));

        act(() => result.current.removePhoto('ph_2'));

        expect(deleteMutate).toHaveBeenCalledWith({ id: 'rec_1', photoId: 'ph_2' }, expect.any(Object));
    });

    it('says so when the delete FAILS — on every platform', () => {
        photosQueryMock.mockReturnValue({ data: photosOf(2) });
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1' }));

        act(() => result.current.removePhoto('ph_2'));
        const options = deleteMutate.mock.calls[0]?.[1] as { onError: () => void };
        act(() => options.onError());

        expect(result.current.errorMessage).toBe(REMOVE_FAILED);
    });

    it('retires an earlier refusal when a photo is removed (the advice it gave)', () => {
        photosQueryMock.mockReturnValue({ data: photosOf(10) });
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1' }));

        act(() => {
            result.current.beginReplace();
        });
        expect(result.current.errorMessage).toBe(REPLACE_AT_CAP);

        act(() => result.current.removePhoto('ph_1'));

        expect(result.current.errorMessage).toBeUndefined();
    });

    it('does nothing before the recipe has an id', () => {
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: null }));

        act(() => result.current.removePhoto('ph_1'));

        expect(deleteMutate).not.toHaveBeenCalled();
    });

    it('names the row being deleted while the mutation is pending', () => {
        deletePhotoMock.mockReturnValue({
            mutate: deleteMutate,
            isPending: true,
            variables: { id: 'rec_1', photoId: 'ph_2' },
        });
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1' }));

        expect(result.current.removingPhotoId).toBe('ph_2');
    });
});

describe('useRecipePhotoManager — set cover', () => {
    it('moves the chosen photo to the front and keeps the rest in order', () => {
        photosQueryMock.mockReturnValue({ data: photosOf(3) });
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1' }));

        act(() => result.current.setCover('ph_3'));

        expect(reorderMutate).toHaveBeenCalledWith(
            { id: 'rec_1', photoIds: ['ph_3', 'ph_1', 'ph_2'] },
            expect.any(Object),
        );
    });

    it('says so when the reorder FAILS — on every platform — and clears the sentence on the next try', () => {
        photosQueryMock.mockReturnValue({ data: photosOf(3) });
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1' }));

        act(() => result.current.setCover('ph_3'));
        const options = reorderMutate.mock.calls[0]?.[1] as { onError: () => void };
        act(() => options.onError());

        expect(result.current.errorMessage).toBe(SET_COVER_FAILED);

        act(() => result.current.setCover('ph_2'));

        expect(result.current.errorMessage).toBeUndefined();
    });
});

describe('useRecipePhotoManager — movePhoto (2026-10-17)', () => {
    it('reorders the whole list with the photo swapped one place earlier', () => {
        photosQueryMock.mockReturnValue({ data: photosOf(3) });
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1' }));

        act(() => result.current.movePhoto('ph_3', 'earlier'));

        expect(reorderMutate).toHaveBeenCalledWith(
            { id: 'rec_1', photoIds: ['ph_1', 'ph_3', 'ph_2'] },
            expect.any(Object),
        );
    });

    it('reorders the whole list with the photo swapped one place later', () => {
        photosQueryMock.mockReturnValue({ data: photosOf(3) });
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1' }));

        act(() => result.current.movePhoto('ph_1', 'later'));

        expect(reorderMutate).toHaveBeenCalledWith(
            { id: 'rec_1', photoIds: ['ph_2', 'ph_1', 'ph_3'] },
            expect.any(Object),
        );
    });

    it('sends nothing for a move off either end', () => {
        photosQueryMock.mockReturnValue({ data: photosOf(3) });
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1' }));

        act(() => result.current.movePhoto('ph_1', 'earlier'));
        act(() => result.current.movePhoto('ph_3', 'later'));

        expect(reorderMutate).not.toHaveBeenCalled();
    });

    it('sends nothing before the recipe has an id', () => {
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: null }));

        act(() => result.current.movePhoto('ph_1', 'later'));

        expect(reorderMutate).not.toHaveBeenCalled();
    });

    it('refuses a second reorder while one is in flight — a stale list is a 400 from the server', () => {
        photosQueryMock.mockReturnValue({ data: photosOf(3) });
        reorderPending.current = true;
        reorderMock.mockReturnValue({ mutate: reorderMutate, isPending: true });
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1' }));

        act(() => result.current.movePhoto('ph_2', 'later'));
        act(() => result.current.setCover('ph_3'));

        expect(result.current.reordering).toBe(true);
        expect(reorderMutate).not.toHaveBeenCalled();
    });

    it('says the move failed in the one error slot', () => {
        photosQueryMock.mockReturnValue({ data: photosOf(3) });
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1' }));

        act(() => result.current.movePhoto('ph_2', 'later'));
        const options = reorderMutate.mock.calls[0]?.[1] as { onError: () => void };
        act(() => options.onError());

        expect(result.current.errorMessage).toBe('We couldn’t move that photo. Please try again.');
    });
});

describe('useRecipePhotoManager — copy', () => {
    it('states the size limit from the shared constant, not a literal', () => {
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1' }));

        act(() => {
            result.current.enqueuePicked([fileOf('big.png', { fileSize: MAX_RECIPE_PHOTO_UPLOAD_BYTES + 1 })], 'add');
        });

        expect(result.current.queue.items[0]?.errorMessage).toBe(
            'That photo is larger than 5 MB. Choose a smaller file.',
        );
    });

    it('rejects a type outside the allowlist with the localized sentence', () => {
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1' }));

        act(() => {
            result.current.enqueuePicked([fileOf('x.gif', { contentType: 'image/gif' })], 'add');
        });

        expect(result.current.queue.items[0]?.errorMessage).toBe(
            'That file type isn’t supported. Use a JPEG, PNG, or WebP photo.',
        );
    });

    it('reports a caller-side failure (a picker error) through the same slot', () => {
        const { result } = renderHook(() => useRecipePhotoManager({ recipeId: 'rec_1' }));

        act(() => result.current.reportError('The camera did not open.'));

        expect(result.current.errorMessage).toBe('The camera did not open.');
    });
});
