/**
 * `useEditorPhotos` — the editor's photo session and its finish barrier (staff-ux SPECIFY and staff-architect BLUEPRINT,
 * 2026-11-10). Written from the spec, before the hook:
 *
 * - a photo picked before a new recipe exists is HELD (owner ruling U33): "Waiting to upload" without a title, queued
 *   with one, and it uploads once the recipe has an id;
 * - an accepted pick asks for the `photoPicked` checkpoint, so a titled draft is created now;
 * - Publish or Save changes LEAVES only once every photo has settled: a failed one holds the editor until the cook
 *   retries or removes it, or finishes without the photos;
 * - leaving with a photo not yet uploaded asks first, and leaving with none goes straight away.
 *
 * The recipe-service hooks are doubled; the REAL manager, queue and upload hook run on top, so a photo's settling is
 * the queue's own verdict, not a stand-in. The mutation lens: a barrier that navigates while a photo is still queued, a
 * pick that never asks for the create, or a leave that goes without asking all fail here.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { presignMock } = vi.hoisted(() => ({ presignMock: vi.fn() }));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined }),
    useCreatePhotoUploadUrl: () => ({ mutateAsync: presignMock }),
    useConfirmPhotoUpload: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) }),
    useRecipePhotos: () => ({ data: [] }),
    useDeleteRecipePhoto: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
    useReorderRecipePhotos: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { useEditorPhotos, type UseEditorPhotosOptions } from '../useEditorPhotos.js';

const fileOf = (name: string) => ({
    blob: new Blob(['x'], { type: 'image/png' }),
    fileName: name,
    contentType: 'image/png',
    fileSize: 5,
});

const fetchMock = vi.fn();

beforeEach(() => {
    presignMock.mockReset().mockResolvedValue({ uploadUrl: 'https://s3.example.com/put', key: 'k1' });
    fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function renderPhotos(initial: Partial<UseEditorPhotosOptions> = {}) {
    const checkpoint = vi.fn();
    const hook = renderHook((props: UseEditorPhotosOptions) => useEditorPhotos(props), {
        initialProps: { recipeId: undefined, draftFloorMet: false, titleMissing: true, checkpoint, ...initial },
    });

    return { ...hook, checkpoint };
}

describe('useEditorPhotos — a photo picked before the recipe exists', () => {
    it('waits without a title, queues with one, and uploads once the recipe has an id', async () => {
        const { result, rerender, checkpoint } = renderPhotos();

        act(() => {
            result.current.manager.enqueuePicked([fileOf('soup.png')], 'add');
        });
        expect(result.current.manager.queue.items[0]?.status).toBe('waiting');
        expect(result.current.waitingForTitle).toBe(true);

        rerender({ recipeId: undefined, draftFloorMet: true, titleMissing: false, checkpoint });
        expect(result.current.manager.queue.items[0]?.status).toBe('queued');
        expect(presignMock).not.toHaveBeenCalled();

        rerender({ recipeId: 'rec_new', draftFloorMet: true, titleMissing: false, checkpoint });
        await waitFor(() => expect(result.current.manager.queue.items[0]?.status).toBe('ok'));
        expect(presignMock.mock.calls[0]?.[0]).toMatchObject({ id: 'rec_new' });
    });

    it('asks for the photo checkpoint when a pick is taken, and not when the pick is refused', () => {
        const { result, checkpoint } = renderPhotos({ draftFloorMet: true, titleMissing: false });

        act(() => {
            result.current.manager.enqueuePicked([fileOf('a.png')], 'add');
        });
        expect(checkpoint).toHaveBeenCalledExactlyOnceWith('photoPicked');

        act(() => {
            result.current.manager.enqueuePicked(
                Array.from({ length: 10 }, (_unused, index) => fileOf(`f${index}.png`)),
                'add',
            );
        });
        expect(checkpoint).toHaveBeenCalledTimes(1);
    });
});

describe('useEditorPhotos — waiting for more than a title', () => {
    /**
     * GATE 2026-11-10: the hold follows the whole draft floor, but the leave ask's "uploads once this recipe has a
     * title" is said only when the title is what is missing.
     */
    it('a titled draft below the floor still waits, but is not "waiting for a title"', () => {
        const { result } = renderPhotos({ draftFloorMet: false, titleMissing: false });

        act(() => {
            result.current.manager.enqueuePicked([fileOf('soup.png')], 'add');
        });

        expect(result.current.manager.queue.items[0]?.status).toBe('waiting');
        expect(result.current.waitingForTitle).toBe(false);
    });
});

describe('useEditorPhotos — the finish barrier', () => {
    it('leaves at once when no photo is pending', () => {
        const { result } = renderPhotos({ recipeId: 'rec_1', draftFloorMet: true, titleMissing: false });
        const go = vi.fn();

        act(() => result.current.finishWhenSettled(go));

        expect(go).toHaveBeenCalledOnce();
        expect(result.current.finish).toBeUndefined();
    });

    it('holds the leave while a photo uploads, then leaves once it lands', async () => {
        let answerPresign: (value: { uploadUrl: string; key: string }) => void = () => undefined;
        presignMock.mockReturnValue(new Promise((resolve) => (answerPresign = resolve)));
        const { result } = renderPhotos({ recipeId: 'rec_1', draftFloorMet: true, titleMissing: false });
        const go = vi.fn();

        act(() => {
            result.current.manager.enqueuePicked([fileOf('a.png')], 'add');
        });
        act(() => result.current.finishWhenSettled(go));

        expect(go).not.toHaveBeenCalled();
        expect(result.current.finish).toEqual({ kind: 'uploading' });
        expect(result.current.finishFocusRequested).toBe(true);

        act(() => result.current.onFinishFocusHandled());
        expect(result.current.finishFocusRequested).toBe(false);

        await act(async () => {
            answerPresign({ uploadUrl: 'https://s3.example.com/put', key: 'k1' });
        });

        await waitFor(() => expect(go).toHaveBeenCalledOnce());
        expect(result.current.finish).toBeUndefined();
    });

    it('stays on a failed photo and says how many failed; removing it then leaves', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 500 });
        const { result } = renderPhotos({ recipeId: 'rec_1', draftFloorMet: true, titleMissing: false });
        const go = vi.fn();

        act(() => {
            result.current.manager.enqueuePicked([fileOf('a.png')], 'add');
        });
        act(() => result.current.finishWhenSettled(go));

        await waitFor(() => expect(result.current.finish).toEqual({ kind: 'failed', count: 1 }));
        expect(go).not.toHaveBeenCalled();

        act(() => result.current.manager.queue.remove(result.current.manager.queue.items[0]?.fileId ?? -1));

        await waitFor(() => expect(go).toHaveBeenCalledOnce());
    });

    it('"Finish without the remaining photos" leaves at once, once', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 500 });
        const { result } = renderPhotos({ recipeId: 'rec_1', draftFloorMet: true, titleMissing: false });
        const go = vi.fn();

        act(() => {
            result.current.manager.enqueuePicked([fileOf('a.png')], 'add');
        });
        act(() => result.current.finishWhenSettled(go));
        await waitFor(() => expect(result.current.finish?.kind).toBe('failed'));

        act(() => result.current.finishWithout());

        await waitFor(() => expect(go).toHaveBeenCalledOnce());
        expect(result.current.atRisk).toBe(false);
    });
});

describe('useEditorPhotos — leaving', () => {
    it('goes straight away when no photo would be lost', () => {
        const { result } = renderPhotos({ recipeId: 'rec_1', draftFloorMet: true, titleMissing: false });
        const proceed = vi.fn();

        act(() => result.current.leave.request(proceed));

        expect(proceed).toHaveBeenCalledOnce();
        expect(result.current.leave.open).toBe(false);
    });

    it('asks first when a photo has not uploaded: Stay keeps the cook, Leave goes once', () => {
        const { result } = renderPhotos();
        const proceed = vi.fn();

        act(() => {
            result.current.manager.enqueuePicked([fileOf('a.png')], 'add');
        });
        expect(result.current.atRisk).toBe(true);

        act(() => result.current.leave.request(proceed));
        expect(result.current.leave.open).toBe(true);
        expect(proceed).not.toHaveBeenCalled();

        act(() => result.current.leave.stay());
        expect(result.current.leave.open).toBe(false);
        expect(proceed).not.toHaveBeenCalled();

        act(() => result.current.leave.request(proceed));
        act(() => result.current.leave.confirm());

        expect(proceed).toHaveBeenCalledOnce();
        expect(result.current.leave.open).toBe(false);
        expect(result.current.atRisk).toBe(false);
    });

    /**
     * staff-architect REVIEW 2026-11-10, finding 1: a leave confirmed while a finish is held used to run BOTH the leave
     * and the released finish, two navigations. The recipe is already saved, so the held finish is the one that runs.
     */
    it('a leave confirmed while a finish is held navigates once, through the finish', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 500 });
        const { result } = renderPhotos({ recipeId: 'rec_1', draftFloorMet: true, titleMissing: false });
        const go = vi.fn();
        const proceed = vi.fn();

        act(() => {
            result.current.manager.enqueuePicked([fileOf('a.png')], 'add');
        });
        act(() => result.current.finishWhenSettled(go));
        await waitFor(() => expect(result.current.finish?.kind).toBe('failed'));

        act(() => result.current.leave.request(proceed));
        act(() => result.current.leave.confirm());

        await waitFor(() => expect(go).toHaveBeenCalledOnce());
        expect(proceed).not.toHaveBeenCalled();
    });
});

/**
 * staff-architect REVIEW 2026-11-10, finding 2: a file the device refused (too large, or not a JPEG, PNG or WebP) has no
 * bytes that could ever upload, so it puts nothing at risk. It still shows as a failed tile with Remove; it does not ask
 * on a leave, hold a finish, count in the leave ask, or ask for a create.
 */
describe('useEditorPhotos — a file the device refused is not at risk', () => {
    const gif = { ...fileOf('clip.gif'), blob: new Blob(['x'], { type: 'image/gif' }), contentType: 'image/gif' };

    it('does not ask on a leave, hold a finish, or ask for the create', () => {
        const { result, checkpoint } = renderPhotos({ draftFloorMet: true, titleMissing: false });
        const go = vi.fn();
        const proceed = vi.fn();

        act(() => {
            result.current.manager.enqueuePicked([gif], 'add');
        });

        expect(result.current.manager.queue.items[0]?.status).toBe('failed');
        expect(result.current.atRisk).toBe(false);
        expect(result.current.atRiskCount).toBe(0);
        expect(checkpoint).not.toHaveBeenCalled();

        act(() => result.current.leave.request(proceed));
        expect(proceed).toHaveBeenCalledOnce();

        act(() => result.current.finishWhenSettled(go));
        expect(go).toHaveBeenCalledOnce();
    });

    it('counts only the photos at risk beside it', () => {
        const { result } = renderPhotos();

        act(() => {
            result.current.manager.enqueuePicked([gif, fileOf('a.png')], 'add');
        });

        expect(result.current.atRisk).toBe(true);
        expect(result.current.atRiskCount).toBe(1);
    });
});
