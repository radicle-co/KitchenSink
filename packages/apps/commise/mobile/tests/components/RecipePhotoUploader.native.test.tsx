/**
 * Component tests for the mobile RecipePhotoUploader (react-native-web under jsdom — see
 * `vitest.native.config.ts`). The uploader composes the shared, presentational `RecipePhotoManager` block
 * (its native leaf) with the native image picker and the presign → PUT → confirm upload orchestration.
 *
 * `expo-image-picker`, the recipe-service hooks, and the global `fetch` are all mocked, so these cover the
 * container's own logic in isolation: the picked-asset happy path (presign → S3 PUT → confirm, in order),
 * a failed S3 PUT surfacing a localized error and clearing the busy state, a canceled pick as a no-op,
 * remove delegating to the delete mutation, the add control hiding at the 10-photo cap, a stale upload-error
 * banner clearing on a fresh (successful) remove (regression), and the add control staying disabled — and
 * `expo-image-picker` staying single-launched — for the full picker-launch + blob-read window, not just once
 * `uploading` flips true (regression, B24 re-entrancy). The native picker itself and the real S3 upload
 * require on-device verification (a Maestro flow) — not reachable here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { RecipePhoto } from '@kitchensink/recipe-core';
import {
    useConfirmPhotoUpload,
    useCreatePhotoUploadUrl,
    useDeleteRecipePhoto,
    useRecipePhotos,
} from '@kitchensink/recipe-service-client/hooks';
import * as ImagePicker from 'expo-image-picker';

import { RecipePhotoUploader } from '../../src/components/RecipePhotoUploader.js';

vi.mock('expo-image-picker', () => ({
    MediaTypeOptions: { Images: 'Images' },
    launchImageLibraryAsync: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipePhotos: vi.fn(),
    useCreatePhotoUploadUrl: vi.fn(),
    useConfirmPhotoUpload: vi.fn(),
    useDeleteRecipePhoto: vi.fn(),
}));

const launchImageLibraryAsyncMock = vi.mocked(ImagePicker.launchImageLibraryAsync);
const useRecipePhotosMock = vi.mocked(useRecipePhotos);
const useCreatePhotoUploadUrlMock = vi.mocked(useCreatePhotoUploadUrl);
const useConfirmPhotoUploadMock = vi.mocked(useConfirmPhotoUpload);
const useDeleteRecipePhotoMock = vi.mocked(useDeleteRecipePhoto);

/** Build a {@link RecipePhoto} with sensible defaults, overridable per field. */
function makePhoto(overrides: Partial<RecipePhoto> = {}): RecipePhoto {
    return {
        id: 'pht_1',
        recipeId: 'rec_1',
        key: 'uploads/rec_1/pht_1.jpg',
        url: 'https://cdn.example.com/pht_1.jpg',
        contentType: 'image/jpeg',
        order: 1,
        createdAt: '2026-04-01T09:00:00.000Z',
        ...overrides,
    };
}

/** The fixed asset the (mocked) picker returns for a successful pick. */
const pickedAsset = {
    uri: 'file:///tmp/picked.jpg',
    fileName: 'picked.jpg',
    mimeType: 'image/jpeg',
    fileSize: 1234,
    width: 800,
    height: 600,
};

/** Build a `useRecipePhotos` query double from the fields the uploader reads. */
function photosResult(photos: readonly RecipePhoto[] = []): ReturnType<typeof useRecipePhotos> {
    return { data: photos, isLoading: false, isError: false } as unknown as ReturnType<typeof useRecipePhotos>;
}

/** Build a mutation double exposing `mutateAsync` (presign / confirm). */
function asyncMutation(mutateAsync = vi.fn()): { mutateAsync: typeof mutateAsync } {
    return { mutateAsync };
}

/** Build a `useDeleteRecipePhoto` mutation double (`mutate` + busy/variables surface). */
function deleteMutation(
    overrides: Partial<ReturnType<typeof useDeleteRecipePhoto>> = {},
): ReturnType<typeof useDeleteRecipePhoto> {
    return {
        mutate: vi.fn(),
        isPending: false,
        variables: undefined,
        ...overrides,
    } as unknown as ReturnType<typeof useDeleteRecipePhoto>;
}

const fetchMock = vi.fn();

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

beforeEach(() => {
    launchImageLibraryAsyncMock.mockReset();
    useRecipePhotosMock.mockReset();
    useCreatePhotoUploadUrlMock.mockReset();
    useConfirmPhotoUploadMock.mockReset();
    useDeleteRecipePhotoMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);

    useRecipePhotosMock.mockReturnValue(photosResult([]));
    useCreatePhotoUploadUrlMock.mockReturnValue(asyncMutation() as never);
    useConfirmPhotoUploadMock.mockReturnValue(asyncMutation() as never);
    useDeleteRecipePhotoMock.mockReturnValue(deleteMutation());
    // Default: a real pick of the fixed asset.
    launchImageLibraryAsyncMock.mockResolvedValue({ canceled: false, assets: [pickedAsset] } as never);
});

describe('RecipePhotoUploader — rendering', () => {
    it('renders the recipe’s photos from the query', () => {
        useRecipePhotosMock.mockReturnValue(
            photosResult([makePhoto({ id: 'pht_1' }), makePhoto({ id: 'pht_2', order: 2 })]),
        );

        render(<RecipePhotoUploader recipeId="rec_1" />);

        expect(screen.getByLabelText('Recipe photo 1')).toBeTruthy();
        expect(screen.getByLabelText('Recipe photo 2')).toBeTruthy();
    });
});

describe('RecipePhotoUploader — upload orchestration', () => {
    it('runs presign → S3 PUT → confirm in order with the picked asset’s metadata', async () => {
        const createMutateAsync = vi.fn().mockResolvedValue({
            uploadUrl: 'https://s3.example.com/put',
            key: 'uploads/rec_1/new.jpg',
            expiresIn: 900,
            maxBytes: 5_242_880,
        });
        const confirmMutateAsync = vi.fn().mockResolvedValue(makePhoto({ id: 'pht_new' }));
        useCreatePhotoUploadUrlMock.mockReturnValue(asyncMutation(createMutateAsync) as never);
        useConfirmPhotoUploadMock.mockReturnValue(asyncMutation(confirmMutateAsync) as never);
        // 1st fetch → read the asset as a Blob; 2nd fetch → the S3 PUT.
        fetchMock
            .mockResolvedValueOnce({ blob: async () => new Blob(['bytes'], { type: 'image/jpeg' }) })
            .mockResolvedValueOnce({ ok: true, status: 200 });

        render(<RecipePhotoUploader recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: 'Add photo' }));

        await waitFor(() => expect(confirmMutateAsync).toHaveBeenCalledTimes(1));

        expect(createMutateAsync).toHaveBeenCalledWith({
            id: 'rec_1',
            request: { fileName: 'picked.jpg', contentType: 'image/jpeg', fileSize: 1234 },
        });
        expect(fetchMock).toHaveBeenNthCalledWith(1, 'file:///tmp/picked.jpg');
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            'https://s3.example.com/put',
            expect.objectContaining({ method: 'PUT', headers: { 'Content-Type': 'image/jpeg' } }),
        );
        expect(confirmMutateAsync).toHaveBeenCalledWith({
            id: 'rec_1',
            request: { key: 'uploads/rec_1/new.jpg', contentType: 'image/jpeg' },
        });

        const presignOrder = createMutateAsync.mock.invocationCallOrder[0];
        const putOrder = fetchMock.mock.invocationCallOrder[1];
        const confirmOrder = confirmMutateAsync.mock.invocationCallOrder[0];
        expect(presignOrder).toBeLessThan(putOrder);
        expect(putOrder).toBeLessThan(confirmOrder);
    });

    it('surfaces a localized error and clears the busy state when the S3 PUT fails', async () => {
        const createMutateAsync = vi.fn().mockResolvedValue({
            uploadUrl: 'https://s3.example.com/put',
            key: 'uploads/rec_1/new.jpg',
            expiresIn: 900,
            maxBytes: 5_242_880,
        });
        const confirmMutateAsync = vi.fn();
        useCreatePhotoUploadUrlMock.mockReturnValue(asyncMutation(createMutateAsync) as never);
        useConfirmPhotoUploadMock.mockReturnValue(asyncMutation(confirmMutateAsync) as never);
        fetchMock
            .mockResolvedValueOnce({ blob: async () => new Blob(['bytes'], { type: 'image/jpeg' }) })
            .mockResolvedValueOnce({ ok: false, status: 403 });

        render(<RecipePhotoUploader recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: 'Add photo' }));

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toContain('We couldn’t add your photo. Please try again.');
        // The upload never confirms, and the busy status is cleared.
        expect(confirmMutateAsync).not.toHaveBeenCalled();
        await waitFor(() => expect(screen.queryByLabelText('Uploading photo')).toBeNull());
    });

    it('does nothing when the pick is canceled', async () => {
        launchImageLibraryAsyncMock.mockResolvedValue({ canceled: true, assets: null } as never);
        const createMutateAsync = vi.fn();
        useCreatePhotoUploadUrlMock.mockReturnValue(asyncMutation(createMutateAsync) as never);

        render(<RecipePhotoUploader recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: 'Add photo' }));

        await waitFor(() => expect(launchImageLibraryAsyncMock).toHaveBeenCalledTimes(1));
        expect(createMutateAsync).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('RecipePhotoUploader — pick re-entrancy (regression)', () => {
    // Regression: pre-refactor, `setUploading(true)` ran BEFORE the blob read, so the add control was
    // disabled for the whole picker-launch + blob-read window. Post-refactor, the blob read happened in this
    // leaf BEFORE `upload()` was called, so the hook's `uploading` was still false through that window and a
    // second tap could launch `expo-image-picker` a second time concurrently. Fails without the local
    // `picking` guard (gating the add control on `uploading || picking` and early-returning `addPhoto`).
    it('disables the add control and single-launches the picker for the full pick + blob-read window', async () => {
        let resolvePick: (result: { canceled: boolean; assets: (typeof pickedAsset)[] | null }) => void = () => {};

        const pickPromise = new Promise<{ canceled: boolean; assets: (typeof pickedAsset)[] | null }>((resolve) => {
            resolvePick = resolve;
        });
        launchImageLibraryAsyncMock.mockReturnValue(pickPromise as never);

        const createMutateAsync = vi.fn().mockResolvedValue({
            uploadUrl: 'https://s3.example.com/put',
            key: 'uploads/rec_1/new.jpg',
            expiresIn: 900,
            maxBytes: 5_242_880,
        });
        const confirmMutateAsync = vi.fn().mockResolvedValue(makePhoto({ id: 'pht_new' }));
        useCreatePhotoUploadUrlMock.mockReturnValue(asyncMutation(createMutateAsync) as never);
        useConfirmPhotoUploadMock.mockReturnValue(asyncMutation(confirmMutateAsync) as never);
        // 1st fetch → read the picked asset as a Blob; 2nd fetch → the S3 PUT.
        fetchMock
            .mockResolvedValueOnce({ blob: async () => new Blob(['bytes'], { type: 'image/jpeg' }) })
            .mockResolvedValueOnce({ ok: true, status: 200 });

        render(<RecipePhotoUploader recipeId="rec_1" />);
        const addButton = screen.getByRole('button', { name: 'Add photo' });

        fireEvent.click(addButton);
        await waitFor(() => expect(launchImageLibraryAsyncMock).toHaveBeenCalledTimes(1));

        // The picker is still open (its promise hasn't settled) — the add control is already disabled, even
        // though the hook's own `uploading` hasn't flipped true yet (upload() isn't called until after the
        // picker resolves AND the blob read completes).
        expect(addButton.getAttribute('aria-disabled')).toBe('true');

        // A second tap during the window is a no-op: the picker is not launched a second time.
        fireEvent.click(addButton);
        expect(launchImageLibraryAsyncMock).toHaveBeenCalledTimes(1);

        resolvePick({ canceled: false, assets: [pickedAsset] });

        await waitFor(() => expect(confirmMutateAsync).toHaveBeenCalledTimes(1));
        // The full sequence ran exactly once, never interleaved by the rejected second tap.
        expect(createMutateAsync).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe('RecipePhotoUploader — remove', () => {
    it('delegates removal to the delete mutation with the photo id', () => {
        const mutate = vi.fn();
        useRecipePhotosMock.mockReturnValue(photosResult([makePhoto({ id: 'pht_42' })]));
        useDeleteRecipePhotoMock.mockReturnValue(deleteMutation({ mutate: mutate as never }));

        render(<RecipePhotoUploader recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }));

        expect(mutate).toHaveBeenCalledWith(
            { id: 'rec_1', photoId: 'pht_42' },
            expect.objectContaining({ onError: expect.any(Function) }),
        );
    });

    it('busies the row whose removal is in flight', () => {
        useRecipePhotosMock.mockReturnValue(photosResult([makePhoto({ id: 'pht_42' })]));
        useDeleteRecipePhotoMock.mockReturnValue(
            deleteMutation({ isPending: true, variables: { id: 'rec_1', photoId: 'pht_42' } as never }),
        );

        render(<RecipePhotoUploader recipeId="rec_1" />);

        expect(screen.getByText('Removing…')).toBeTruthy();
    });

    // Regression: pre-refactor, `removePhoto` unconditionally cleared ANY prior error before every remove.
    // Post-refactor (the `useRecipePhotoUpload` extraction, 9fbcbb0a), the displayed error preferred the
    // hook's own `errorMessage`, which only clears on a NEW `upload()` — so a failed upload followed by a
    // successful, unrelated remove left the upload-error banner on screen forever. Fails without the
    // `uploadErrorSlot` mirror + its clear in `removePhoto`.
    it('clears a stale upload-error banner when a fresh remove is initiated', async () => {
        const createMutateAsync = vi.fn().mockResolvedValue({
            uploadUrl: 'https://s3.example.com/put',
            key: 'uploads/rec_1/new.jpg',
            expiresIn: 900,
            maxBytes: 5_242_880,
        });
        const confirmMutateAsync = vi.fn();
        useCreatePhotoUploadUrlMock.mockReturnValue(asyncMutation(createMutateAsync) as never);
        useConfirmPhotoUploadMock.mockReturnValue(asyncMutation(confirmMutateAsync) as never);
        fetchMock
            .mockResolvedValueOnce({ blob: async () => new Blob(['bytes'], { type: 'image/jpeg' }) })
            .mockResolvedValueOnce({ ok: false, status: 403 });

        const mutate = vi.fn();
        useRecipePhotosMock.mockReturnValue(photosResult([makePhoto({ id: 'pht_42' })]));
        useDeleteRecipePhotoMock.mockReturnValue(deleteMutation({ mutate: mutate as never }));

        render(<RecipePhotoUploader recipeId="rec_1" />);

        // A failed upload leaves the localized error banner up.
        fireEvent.click(screen.getByRole('button', { name: 'Add photo' }));
        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toContain('We couldn’t add your photo. Please try again.');

        // A fresh remove is initiated (and — since `onError` is never invoked here — succeeds): the stale
        // upload-error banner must clear, not persist.
        fireEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }));

        expect(mutate).toHaveBeenCalledWith(
            { id: 'rec_1', photoId: 'pht_42' },
            expect.objectContaining({ onError: expect.any(Function) }),
        );
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('RecipePhotoUploader — photo cap', () => {
    it('hides the add control once the recipe is at the 10-photo cap', () => {
        const photos = Array.from({ length: 10 }, (_unused, index) =>
            makePhoto({ id: `pht_${index + 1}`, order: index + 1 }),
        );
        useRecipePhotosMock.mockReturnValue(photosResult(photos));

        render(<RecipePhotoUploader recipeId="rec_1" />);

        expect(screen.queryByRole('button', { name: 'Add photo' })).toBeNull();
        expect(screen.getByText('Maximum of 10 photos reached.')).toBeTruthy();
    });
});
