/**
 * Component tests for the mobile RecipePhotoUploader (react-native-web under jsdom — see
 * `vitest.native.config.ts`). The uploader composes the shared, presentational `RecipePhotoManager` block
 * (its native leaf) with the native image picker and the `useRecipePhotoUploadQueue` layer (w3/e4) over the
 * single-flight presign → PUT → confirm upload orchestration.
 *
 * `expo-image-picker`, the recipe-service hooks, and the global `fetch` are all mocked, so these cover the
 * container's own logic in isolation: the picked-asset happy path (presign → S3 PUT → confirm, in order),
 * a failed S3 PUT surfacing the picked file's own FAILED badge + Retry (per-file, not a blanket banner),
 * retrying re-driving only that file, a canceled pick as a no-op, remove delegating to the delete mutation,
 * the add control hiding at the 10-photo cap, and the add control staying disabled — and `expo-image-picker`
 * staying single-launched — for the full picker-launch + blob-read window (regression, B24-adjacent
 * re-entrancy) while staying ENABLED during an in-flight upload (a second pick now queues, per w3/e4).
 *
 * U6's CANCEL-SAFE replace is pinned too (upload-first, then swap): a cancelled picker, an unreadable asset,
 * and a failed upload each leave the replaced photo intact; a confirmed replacement deletes exactly that photo
 * (after the confirm, never before) and issues no reorder, so the lowest-sort-order cover rule is untouched;
 * and Replace at the photo cap refuses — no picker, no delete — with actionable copy.
 *
 * The native picker itself and the real S3 upload require on-device verification (a Maestro flow) — not
 * reachable here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MAX_RECIPE_PHOTO_UPLOAD_BYTES } from '@kitchensink/recipe-core';
import type { RecipePhoto } from '@kitchensink/recipe-core';
import {
    useConfirmPhotoUpload,
    useCreatePhotoUploadUrl,
    useDeleteRecipePhoto,
    useRecipePhotos,
    useReorderRecipePhotos,
} from '@kitchensink/recipe-service-client/hooks';
import * as ImagePicker from 'expo-image-picker';

import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';

import { RecipePhotoUploader } from '../../src/components/RecipePhotoUploader.js';

// The device's scheme, for the D15 case below; every other case leaves it unset and reads the light roles.
vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

vi.mock('expo-image-picker', () => ({
    MediaTypeOptions: { Images: 'Images' },
    launchImageLibraryAsync: vi.fn(),
    // A-010: the camera path asks for permission, then launches. Both are doubles per case.
    requestCameraPermissionsAsync: vi.fn(),
    launchCameraAsync: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    // U5 — the analytics emitter's context read; a resolved stub keeps emission inert in leaf tests.
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined }),
    useRecipePhotos: vi.fn(),
    useCreatePhotoUploadUrl: vi.fn(),
    useConfirmPhotoUpload: vi.fn(),
    useDeleteRecipePhoto: vi.fn(),
    // U6: the uploader now wires "Set as cover" to the reorder mutation. A stable inert double keeps every
    // existing case (which never sets a cover) working; the cover case below overrides `mutate`.
    useReorderRecipePhotos: vi.fn(() => ({ mutate: vi.fn(), isPending: false, reset: vi.fn() })),
}));

const launchImageLibraryAsyncMock = vi.mocked(ImagePicker.launchImageLibraryAsync);
const launchCameraAsyncMock = vi.mocked(ImagePicker.launchCameraAsync);
const requestCameraPermissionsAsyncMock = vi.mocked(ImagePicker.requestCameraPermissionsAsync);
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
    systemScheme.current = null;
});

beforeEach(() => {
    launchImageLibraryAsyncMock.mockReset();
    launchCameraAsyncMock.mockReset();
    requestCameraPermissionsAsyncMock.mockReset();
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
    launchCameraAsyncMock.mockResolvedValue({ canceled: false, assets: [pickedAsset] } as never);
    requestCameraPermissionsAsyncMock.mockResolvedValue({ granted: true, canAskAgain: true } as never);
});

/**
 * The gesture a cook makes to add from the library: press Add photos, then the sheet's "Choose from library". A-010
 * put a choice between the button and the picker, so every case that used to press Add photo and expect the library
 * now makes both presses. The picker itself opens only once the sheet has gone (see the uploader), so callers wait
 * on the picker or on what follows it.
 */
function chooseFromLibrary(): void {
    fireEvent.click(screen.getByRole('button', { name: 'Add photos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose from library' }));
}

/** The same gesture for the camera. */
function takePhoto(): void {
    fireEvent.click(screen.getByRole('button', { name: 'Add photos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
}

/**
 * D15: the add control's label paints from the `ink` role in both schemes. Measured on the emulator in dark mode
 * (2026-10-09): an unpainted label drew React Native's default black on the dark canvas, so "Add photos" could not be
 * seen and the photos flow could not find it.
 */
describe.each(['light', 'dark'] as const)('RecipePhotoUploader — the %s scheme', (scheme) => {
    it('labels Add photos in ink', () => {
        systemScheme.current = scheme;
        render(<RecipePhotoUploader recipeId="rec_1" />);

        expect(getComputedStyle(screen.getByText('Add photos')).color).toBe(
            rgb((scheme === 'dark' ? roleDark : role).ink),
        );
    });
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

/**
 * U33 — a control is offered only where its action has somewhere to go.
 *
 * Before the recipe exists a pick can only land in the draft (`onPick`), and a draft cell can only be removed by
 * its owner (`onRemoveDraft`). The create screen withholds both while its create is in flight, because the flush
 * it issues on success hands over the draft as it stood when the save was pressed. An add control with no
 * destination would enqueue against a recipe id of `''`; a Remove with no handler would do nothing.
 */
describe('RecipePhotoUploader — draft destination (U33)', () => {
    const draft = { localId: 'draft-photo-1', fileName: 'draft.png', contentType: 'image/png', fileSize: 1 };

    it('offers no add control when the recipe has no id and no pick destination is wired', () => {
        render(<RecipePhotoUploader recipeId={null} />);

        expect(screen.queryByRole('button', { name: 'Add photos' })).toBeNull();
    });

    it('offers the add control before the recipe exists when a pick destination is wired', () => {
        render(<RecipePhotoUploader recipeId={null} onPick={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Add photos' })).toBeTruthy();
    });

    it('offers no Remove on a draft cell when no draft remove handler is wired', () => {
        render(<RecipePhotoUploader recipeId={null} pendingDrafts={[draft]} />);

        expect(screen.queryByRole('button', { name: /Remove draft\.png/u })).toBeNull();
    });

    it('offers Remove on a draft cell, reporting its index, when the handler is wired', () => {
        const onRemoveDraft = vi.fn();

        render(<RecipePhotoUploader recipeId={null} pendingDrafts={[draft]} onRemoveDraft={onRemoveDraft} />);
        fireEvent.click(screen.getByRole('button', { name: /Remove draft\.png/u }));

        expect(onRemoveDraft).toHaveBeenCalledWith(0);
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
        chooseFromLibrary();

        await waitFor(() => expect(confirmMutateAsync).toHaveBeenCalledTimes(1));

        expect(createMutateAsync).toHaveBeenCalledWith({
            id: 'rec_1',
            // fileSize is the BLOB's size (5 bytes — `new Blob(['bytes'])`), not the picked asset's own
            // `fileSize` metadata (1234) — see the RecipePhotoUploader parity regression tests below for why.
            request: { fileName: 'picked.jpg', contentType: 'image/jpeg', fileSize: 5 },
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

    it('rejects an oversized picked asset client-side (by the BLOB’s real size) — never calls presign, shows the size error', async () => {
        // The asset's own metadata size is well UNDER the cap here — the blob itself is what's oversized.
        // Proves validation is driven by the authoritative blob, not by trusting `asset.fileSize`.
        launchImageLibraryAsyncMock.mockResolvedValue({
            canceled: false,
            assets: [{ ...pickedAsset, fileSize: 100 }],
        } as never);
        const createMutateAsync = vi.fn();
        useCreatePhotoUploadUrlMock.mockReturnValue(asyncMutation(createMutateAsync) as never);
        // The container reads the picked asset's bytes as a Blob BEFORE enqueueing — that read still
        // happens (validation is the queue's job, once the file is handed to it); only the S3 PUT it would
        // otherwise be followed by never fires.
        fetchMock.mockResolvedValueOnce({
            blob: async () => new Blob([new Uint8Array(MAX_RECIPE_PHOTO_UPLOAD_BYTES + 1)], { type: 'image/jpeg' }),
        });

        render(<RecipePhotoUploader recipeId="rec_1" />);
        chooseFromLibrary();

        expect(await screen.findByText('That photo is larger than 5 MB. Choose a smaller file.')).toBeTruthy();
        expect(createMutateAsync).not.toHaveBeenCalled();
        // Only the local blob read happened — no second fetch (the S3 PUT) was ever made.
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // Regression (final-review Finding 2): expo-image-picker's `fileSize` is often null/undefined on
    // Android/web. The pre-fix code defaulted it with `?? 0`, so `validatePhotoFile` saw `0 > MAX` = false
    // and silently ADMITTED an oversized file — defeating REQ-011's client pre-check exactly when it
    // mattered most (the platform that can't report a size). Confirms the fix reads the size from the
    // already-read blob instead.
    it('rejects an oversized picked asset when the picker reports NO fileSize at all (asset.fileSize undefined) — parity regression', async () => {
        launchImageLibraryAsyncMock.mockResolvedValue({
            canceled: false,
            assets: [{ ...pickedAsset, fileSize: undefined }],
        } as never);
        const createMutateAsync = vi.fn();
        useCreatePhotoUploadUrlMock.mockReturnValue(asyncMutation(createMutateAsync) as never);
        fetchMock.mockResolvedValueOnce({
            blob: async () => new Blob([new Uint8Array(MAX_RECIPE_PHOTO_UPLOAD_BYTES + 1)], { type: 'image/jpeg' }),
        });

        render(<RecipePhotoUploader recipeId="rec_1" />);
        chooseFromLibrary();

        expect(await screen.findByText('That photo is larger than 5 MB. Choose a smaller file.')).toBeTruthy();
        expect(createMutateAsync).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects a disallowed MIME type client-side — never calls presign, shows the type error', async () => {
        launchImageLibraryAsyncMock.mockResolvedValue({
            canceled: false,
            assets: [{ ...pickedAsset, mimeType: 'image/gif', fileName: 'clip.gif' }],
        } as never);
        const createMutateAsync = vi.fn();
        useCreatePhotoUploadUrlMock.mockReturnValue(asyncMutation(createMutateAsync) as never);
        fetchMock.mockResolvedValueOnce({ blob: async () => new Blob(['bytes'], { type: 'image/gif' }) });

        render(<RecipePhotoUploader recipeId="rec_1" />);
        chooseFromLibrary();

        expect(await screen.findByText('That file type isn’t supported. Use a JPEG, PNG, or WebP photo.')).toBeTruthy();
        expect(createMutateAsync).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each(['image/jpeg', 'image/png', 'image/webp'])(
        'accepts an allowlisted type (%s) at ≤5 MB and calls presign',
        async (mimeType) => {
            launchImageLibraryAsyncMock.mockResolvedValue({
                canceled: false,
                assets: [{ ...pickedAsset, mimeType }],
            } as never);
            const createMutateAsync = vi.fn().mockResolvedValue({
                uploadUrl: 'https://s3.example.com/put',
                key: 'uploads/rec_1/new.jpg',
                expiresIn: 900,
                maxBytes: 5_242_880,
            });
            useCreatePhotoUploadUrlMock.mockReturnValue(asyncMutation(createMutateAsync) as never);
            useConfirmPhotoUploadMock.mockReturnValue(asyncMutation(vi.fn().mockResolvedValue(makePhoto())) as never);
            fetchMock
                .mockResolvedValueOnce({ blob: async () => new Blob(['bytes'], { type: mimeType }) })
                .mockResolvedValueOnce({ ok: true, status: 200 });

            render(<RecipePhotoUploader recipeId="rec_1" />);
            chooseFromLibrary();

            await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1));
            expect(createMutateAsync).toHaveBeenCalledWith({
                id: 'rec_1',
                // The blob's size (5 bytes), not the asset's own `fileSize` metadata — see the parity
                // regression tests above.
                request: { fileName: 'picked.jpg', contentType: mimeType, fileSize: 5 },
            });
        },
    );

    it('surfaces the picked file’s own FAILED badge + Retry when the S3 PUT fails (not a blanket banner)', async () => {
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
        chooseFromLibrary();

        expect(await screen.findByRole('alert', { name: 'Upload failed' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Retry upload of picked.jpg' })).toBeTruthy();
        // The upload never confirms, and the busy status is cleared.
        expect(confirmMutateAsync).not.toHaveBeenCalled();
        await waitFor(() => expect(screen.queryByLabelText('Uploading photo')).toBeNull());
    });

    it('retries only the failed file, flipping it to uploading then confirming', async () => {
        const createMutateAsync = vi
            .fn()
            .mockResolvedValueOnce({
                uploadUrl: 'https://s3.example.com/put',
                key: 'uploads/rec_1/new.jpg',
                expiresIn: 900,
                maxBytes: 5_242_880,
            })
            .mockResolvedValueOnce({
                uploadUrl: 'https://s3.example.com/put',
                key: 'uploads/rec_1/new.jpg',
                expiresIn: 900,
                maxBytes: 5_242_880,
            });
        const confirmMutateAsync = vi.fn().mockResolvedValue(makePhoto({ id: 'pht_new' }));
        useCreatePhotoUploadUrlMock.mockReturnValue(asyncMutation(createMutateAsync) as never);
        useConfirmPhotoUploadMock.mockReturnValue(asyncMutation(confirmMutateAsync) as never);
        fetchMock
            .mockResolvedValueOnce({ blob: async () => new Blob(['bytes'], { type: 'image/jpeg' }) })
            .mockResolvedValueOnce({ ok: false, status: 403 });

        render(<RecipePhotoUploader recipeId="rec_1" />);
        chooseFromLibrary();
        await screen.findByRole('alert', { name: 'Upload failed' });

        fetchMock.mockResolvedValue({ ok: true, status: 200 });
        fireEvent.click(screen.getByRole('button', { name: 'Retry upload of picked.jpg' }));

        await waitFor(() => expect(confirmMutateAsync).toHaveBeenCalledTimes(1));
        expect(createMutateAsync).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('alert', { name: 'Upload failed' })).toBeNull();
    });

    it('does nothing when the pick is canceled', async () => {
        launchImageLibraryAsyncMock.mockResolvedValue({ canceled: true, assets: null } as never);
        const createMutateAsync = vi.fn();
        useCreatePhotoUploadUrlMock.mockReturnValue(asyncMutation(createMutateAsync) as never);

        render(<RecipePhotoUploader recipeId="rec_1" />);
        chooseFromLibrary();

        await waitFor(() => expect(launchImageLibraryAsyncMock).toHaveBeenCalledTimes(1));
        expect(createMutateAsync).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

/**
 * A-010 (buildSpec §7.7): the add control is a secondary button that opens a sheet with two choices, where it used to
 * be a bare pressable that went straight to the library with no camera path at all.
 */
describe('RecipePhotoUploader — the Add photos sheet (A-010)', () => {
    it('opens a sheet titled Add photos with "Take photo" and "Choose from library"', () => {
        render(<RecipePhotoUploader recipeId="rec_1" />);
        expect(screen.queryByRole('button', { name: 'Take photo' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Add photos' }));

        expect(screen.getByRole('heading', { name: 'Add photos' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Take photo' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Choose from library' })).toBeTruthy();
    });

    it('launches nothing when the sheet is closed without a choice', async () => {
        render(<RecipePhotoUploader recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: 'Add photos' }));

        fireEvent.click(screen.getByRole('button', { name: 'Close add photos' }));

        await waitFor(() => expect(screen.queryByRole('button', { name: 'Take photo' })).toBeNull());
        expect(launchImageLibraryAsyncMock).not.toHaveBeenCalled();
        expect(launchCameraAsyncMock).not.toHaveBeenCalled();
        expect(requestCameraPermissionsAsyncMock).not.toHaveBeenCalled();
    });

    it('goes to the library on "Choose from library" — with no camera permission asked for', async () => {
        render(<RecipePhotoUploader recipeId="rec_1" />);

        chooseFromLibrary();

        await waitFor(() => expect(launchImageLibraryAsyncMock).toHaveBeenCalledTimes(1));
        expect(launchCameraAsyncMock).not.toHaveBeenCalled();
        expect(requestCameraPermissionsAsyncMock).not.toHaveBeenCalled();
    });

    it('closes the sheet once a choice is made', async () => {
        render(<RecipePhotoUploader recipeId="rec_1" />);

        chooseFromLibrary();

        await waitFor(() => expect(screen.queryByRole('button', { name: 'Choose from library' })).toBeNull());
    });

    it('offers the same sheet before the recipe exists, where a pick goes to the draft', async () => {
        const onPick = vi.fn();
        fetchMock.mockResolvedValueOnce({ blob: async () => new Blob(['bytes'], { type: 'image/jpeg' }) });

        render(<RecipePhotoUploader recipeId={null} onPick={onPick} />);
        takePhoto();

        await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    });
});

/**
 * A-010: "Take photo" asks for the camera permission first and launches only when it is granted. A refusal says so in
 * plain words and points at the library — it is not a silent no-op, and not a crash.
 */
describe('RecipePhotoUploader — the camera path (A-010)', () => {
    it('asks for the camera permission, then launches the camera, and uploads what it returns', async () => {
        const createMutateAsync = vi.fn().mockResolvedValue({
            uploadUrl: 'https://s3.example.com/put',
            key: 'uploads/rec_1/new.jpg',
            expiresIn: 900,
            maxBytes: 5_242_880,
        });
        const confirmMutateAsync = vi.fn().mockResolvedValue(makePhoto({ id: 'pht_new' }));
        useCreatePhotoUploadUrlMock.mockReturnValue(asyncMutation(createMutateAsync) as never);
        useConfirmPhotoUploadMock.mockReturnValue(asyncMutation(confirmMutateAsync) as never);
        fetchMock
            .mockResolvedValueOnce({ blob: async () => new Blob(['bytes'], { type: 'image/jpeg' }) })
            .mockResolvedValueOnce({ ok: true, status: 200 });

        render(<RecipePhotoUploader recipeId="rec_1" />);
        takePhoto();

        await waitFor(() => expect(confirmMutateAsync).toHaveBeenCalledTimes(1));
        expect(launchCameraAsyncMock).toHaveBeenCalledTimes(1);
        expect(launchImageLibraryAsyncMock).not.toHaveBeenCalled();
        expect(requestCameraPermissionsAsyncMock.mock.invocationCallOrder[0]).toBeLessThan(
            launchCameraAsyncMock.mock.invocationCallOrder[0] as number,
        );
        // The camera's asset goes through the SAME pre-validation and queue as a library pick.
        expect(createMutateAsync).toHaveBeenCalledWith({
            id: 'rec_1',
            request: { fileName: 'picked.jpg', contentType: 'image/jpeg', fileSize: 5 },
        });
    });

    it.each([
        ['refused', { granted: false, canAskAgain: true }],
        ['blocked for good', { granted: false, canAskAgain: false }],
    ])('says why nothing opened, and launches nothing, when the permission is %s', async (_case, answer) => {
        requestCameraPermissionsAsyncMock.mockResolvedValue(answer as never);

        render(<RecipePhotoUploader recipeId="rec_1" />);
        takePhoto();

        expect(
            await screen.findByText(
                'Camera access is off. Turn it on in your phone’s settings, or choose a photo from your library.',
            ),
        ).toBeTruthy();
        expect(launchCameraAsyncMock).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('leaves the add control usable after a refusal, so the library is one press away', async () => {
        requestCameraPermissionsAsyncMock.mockResolvedValue({ granted: false, canAskAgain: false } as never);

        render(<RecipePhotoUploader recipeId="rec_1" />);
        takePhoto();
        await screen.findByRole('alert');

        expect(screen.getByRole('button', { name: 'Add photos' }).getAttribute('aria-disabled')).not.toBe('true');

        chooseFromLibrary();
        await waitFor(() => expect(launchImageLibraryAsyncMock).toHaveBeenCalledTimes(1));
    });

    it('clears the refusal when the next attempt is made', async () => {
        requestCameraPermissionsAsyncMock.mockResolvedValueOnce({ granted: false, canAskAgain: true } as never);

        render(<RecipePhotoUploader recipeId="rec_1" />);
        takePhoto();
        await screen.findByRole('alert');

        chooseFromLibrary();

        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    });

    it('does nothing when the camera is dismissed without a shot', async () => {
        launchCameraAsyncMock.mockResolvedValue({ canceled: true, assets: null } as never);

        render(<RecipePhotoUploader recipeId="rec_1" />);
        takePhoto();

        await waitFor(() => expect(launchCameraAsyncMock).toHaveBeenCalledTimes(1));
        expect(fetchMock).not.toHaveBeenCalled();
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Add photos' }).getAttribute('aria-busy')).toBeNull(),
        );
    });

    it('says so, and frees the add control, when the camera fails to open (a device with none)', async () => {
        launchCameraAsyncMock.mockRejectedValue(new Error('Camera not available on simulator'));

        render(<RecipePhotoUploader recipeId="rec_1" />);
        takePhoto();

        expect(
            await screen.findByText('The camera did not open. Try again, or choose a photo from your library.'),
        ).toBeTruthy();
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Add photos' }).getAttribute('aria-busy')).toBeNull(),
        );
    });
});

/** A-010 (§7.7): with no photo the section previews this recipe's own cover and says what happens. */
describe('RecipePhotoUploader — the empty state (A-010)', () => {
    it('says the cover is used instead, with the recipe’s cover beside it', () => {
        render(<RecipePhotoUploader recipeId="rec_1" title="Lemon tart" />);

        expect(screen.getByText('No photo? This cover is used instead. Add one any time.')).toBeTruthy();
        expect(screen.getByText('L')).toBeTruthy();
    });

    it('previews the cover on a create that has no id yet', () => {
        render(<RecipePhotoUploader recipeId={null} onPick={vi.fn()} title="Lemon tart" />);

        expect(screen.getByText('L')).toBeTruthy();
    });

    it('shows no empty state when the recipe has a photo', () => {
        useRecipePhotosMock.mockReturnValue(photosResult([makePhoto()]));

        render(<RecipePhotoUploader recipeId="rec_1" title="Lemon tart" />);

        expect(screen.queryByText('No photo? This cover is used instead. Add one any time.')).toBeNull();
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
        const addButton = screen.getByRole('button', { name: 'Add photos' });

        chooseFromLibrary();
        await waitFor(() => expect(launchImageLibraryAsyncMock).toHaveBeenCalledTimes(1));

        // The picker is still open (its promise hasn't settled) — the add control is already disabled, even
        // though the hook's own `uploading` hasn't flipped true yet (upload() isn't called until after the
        // picker resolves AND the blob read completes).
        expect(addButton.getAttribute('aria-disabled')).toBe('true');

        // A second tap during the window is a no-op: the sheet does not open again, so the picker cannot be
        // launched a second time.
        fireEvent.click(addButton);
        expect(screen.queryByRole('button', { name: 'Choose from library' })).toBeNull();
        expect(launchImageLibraryAsyncMock).toHaveBeenCalledTimes(1);

        resolvePick({ canceled: false, assets: [pickedAsset] });

        await waitFor(() => expect(confirmMutateAsync).toHaveBeenCalledTimes(1));
        // The full sequence ran exactly once, never interleaved by the rejected second tap.
        expect(createMutateAsync).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    /**
     * The case above proved the DISABLED half of the pick window reaches the DOM — and it does so for free,
     * because RNW derives `aria-disabled` from the `disabled` PROP. The BUSY half did not (#123):
     * react-native-web 0.20.0's `forwardedProps` allowlist carries every literal `aria-*` attribute but has NO
     * entry that projects `accessibilityState` (its only consumer anywhere in the package,
     * `AccessibilityUtil/isDisabled`, reads `props.disabled` and the LEGACY `accessibilityStates` array).
     *
     * That matters most on exactly this control. The pick window is a period where the app is doing work with NO
     * other affordance at all — the label never changes, no spinner is rendered, and the native picker is a
     * system sheet — so `aria-busy` is the only channel that distinguishes "the picker is opening" from "this
     * button is dead". Without it a screen-reader user got "Add photos, unavailable" and nothing else.
     *
     * `aria-busy` is RN's own first-class ALIAS for `accessibilityState.busy` (`ViewAccessibility.d.ts`), so it
     * is device-correct too, and the object form stays (RN reverse-maps `aria-busy` into
     * `accessibilityState.busy`).
     */
    it('marks the add control busy — not merely disabled — for the pick + blob-read window', async () => {
        let resolvePick: (result: { canceled: boolean; assets: (typeof pickedAsset)[] | null }) => void = () => {};

        const pickPromise = new Promise<{ canceled: boolean; assets: (typeof pickedAsset)[] | null }>((resolve) => {
            resolvePick = resolve;
        });
        launchImageLibraryAsyncMock.mockReturnValue(pickPromise as never);

        render(<RecipePhotoUploader recipeId="rec_1" />);
        const addButton = screen.getByRole('button', { name: 'Add photos' });

        // Idle: unmarked, and distinguishable from disabled.
        expect(addButton.getAttribute('aria-busy')).toBeNull();
        expect(addButton.hasAttribute('disabled')).toBe(false);

        chooseFromLibrary();
        await waitFor(() => expect(launchImageLibraryAsyncMock).toHaveBeenCalledTimes(1));

        expect(addButton.getAttribute('aria-busy')).toBe('true');

        // Settle the pick so the test does not leave the picker promise dangling.
        resolvePick({ canceled: true, assets: null });
        await waitFor(() => expect(addButton.getAttribute('aria-busy')).toBeNull());
    });
});

describe('RecipePhotoUploader — queueing a second pick while uploading (w3/e4)', () => {
    it('accepts a second pick while the first is uploading — the add control stays enabled, and the second queues', async () => {
        let resolveFirstPresign: (value: {
            uploadUrl: string;
            key: string;
            expiresIn: number;
            maxBytes: number;
        }) => void = () => {};

        const createMutateAsync = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveFirstPresign = resolve;
                    }),
            )
            .mockResolvedValue({
                uploadUrl: 'https://s3.example.com/put',
                key: 'uploads/rec_1/second.jpg',
                expiresIn: 900,
                maxBytes: 5_242_880,
            });
        const confirmMutateAsync = vi.fn().mockResolvedValue(makePhoto({ id: 'pht_new' }));
        useCreatePhotoUploadUrlMock.mockReturnValue(asyncMutation(createMutateAsync) as never);
        useConfirmPhotoUploadMock.mockReturnValue(asyncMutation(confirmMutateAsync) as never);
        fetchMock.mockResolvedValue({ blob: async () => new Blob(['bytes'], { type: 'image/jpeg' }) });

        render(<RecipePhotoUploader recipeId="rec_1" />);
        const addButton = screen.getByRole('button', { name: 'Add photos' });

        chooseFromLibrary();
        await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1));

        // The first upload is mid-flight, but the add control is NOT disabled (only `picking` disables it) —
        // a second pick is welcomed, not rejected.
        expect(addButton.getAttribute('aria-disabled')).not.toBe('true');

        chooseFromLibrary();
        await waitFor(() => expect(launchImageLibraryAsyncMock).toHaveBeenCalledTimes(2));

        // The second file is queued, not started — its presign must not have fired yet.
        expect(createMutateAsync).toHaveBeenCalledTimes(1);
        expect(screen.getByLabelText('Queued')).toBeTruthy();

        fetchMock.mockResolvedValue({ ok: true, status: 200 });
        resolveFirstPresign({
            uploadUrl: 'https://s3.example.com/put',
            key: 'uploads/rec_1/first.jpg',
            expiresIn: 900,
            maxBytes: 5_242_880,
        });

        await waitFor(() => expect(confirmMutateAsync).toHaveBeenCalledTimes(1));
        // Only once the first settled did the second file's presign fire.
        await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(confirmMutateAsync).toHaveBeenCalledTimes(2));
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

    it('says so when the delete fails, and a later removal retires the message', () => {
        const mutate = vi.fn();
        useRecipePhotosMock.mockReturnValue(photosResult([makePhoto({ id: 'pht_42' })]));
        useDeleteRecipePhotoMock.mockReturnValue(deleteMutation({ mutate: mutate as never }));

        render(<RecipePhotoUploader recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }));
        const options = mutate.mock.calls[0]?.[1] as { onError: () => void };
        act(() => options.onError());

        expect(screen.getByText('We couldn’t remove this photo. Please try again.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }));

        expect(screen.queryByText('We couldn’t remove this photo. Please try again.')).toBeNull();
    });

    it('busies the row whose removal is in flight', () => {
        useRecipePhotosMock.mockReturnValue(photosResult([makePhoto({ id: 'pht_42' })]));
        useDeleteRecipePhotoMock.mockReturnValue(
            deleteMutation({ isPending: true, variables: { id: 'rec_1', photoId: 'pht_42' } as never }),
        );

        render(<RecipePhotoUploader recipeId="rec_1" />);

        expect(screen.getByText('Removing…')).toBeTruthy();
    });

    // w3/e4 supersedes the pre-queue "global upload-error banner" design (and the `uploadErrorSlot`
    // cross-clear it needed): a failed FILE's badge is now scoped to that queue item, so an unrelated fresh
    // remove of a CONFIRMED photo must not touch it — there is no longer a shared global slot to stomp.
    it('leaves an unrelated failed queue item’s badge untouched by a fresh remove of a confirmed photo', async () => {
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

        // A failed upload leaves that file's own FAILED badge up.
        chooseFromLibrary();
        await screen.findByRole('alert', { name: 'Upload failed' });

        // A fresh, UNRELATED remove of the confirmed photo (and — since `onError` is never invoked here —
        // succeeds) must not clear the failed queue item's own badge; the two are independent now.
        fireEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }));

        expect(mutate).toHaveBeenCalledWith(
            { id: 'rec_1', photoId: 'pht_42' },
            expect.objectContaining({ onError: expect.any(Function) }),
        );
        expect(screen.getByRole('alert', { name: 'Upload failed' })).toBeTruthy();
    });
});

describe('RecipePhotoUploader — cancel-safe replace (U6)', () => {
    const twoPhotos = [makePhoto({ id: 'pht_1', order: 1 }), makePhoto({ id: 'pht_2', order: 2 })];

    /** A presign double that always resolves, for the paths that get as far as the transport layer. */
    const presignOk = () =>
        vi.fn().mockResolvedValue({
            uploadUrl: 'https://s3.example.com/put',
            key: 'uploads/rec_1/replacement.jpg',
            expiresIn: 900,
            maxBytes: 5_242_880,
        });

    it('leaves the original untouched when the picker is CANCELED', async () => {
        const mutate = vi.fn();
        useRecipePhotosMock.mockReturnValue(photosResult(twoPhotos));
        useDeleteRecipePhotoMock.mockReturnValue(deleteMutation({ mutate: mutate as never }));
        launchImageLibraryAsyncMock.mockResolvedValue({ canceled: true, assets: null } as never);

        render(<RecipePhotoUploader recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: 'Replace photo 2' }));

        await waitFor(() => expect(launchImageLibraryAsyncMock).toHaveBeenCalledTimes(1));
        // The regression this pins: the old wiring deleted the photo BEFORE opening the picker, so a cancel
        // destroyed the original.
        expect(mutate).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Recipe photo 2')).toBeTruthy();
    });

    it('leaves the original untouched when the picked asset’s local blob read fails', async () => {
        const mutate = vi.fn();
        useRecipePhotosMock.mockReturnValue(photosResult(twoPhotos));
        useDeleteRecipePhotoMock.mockReturnValue(deleteMutation({ mutate: mutate as never }));
        fetchMock.mockRejectedValueOnce(new Error('unreadable asset'));

        render(<RecipePhotoUploader recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: 'Replace photo 2' }));

        expect(await screen.findByText('We couldn’t upload that photo. Please try again.')).toBeTruthy();
        expect(mutate).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Recipe photo 2')).toBeTruthy();
    });

    it('leaves the original untouched when the replacement upload FAILS', async () => {
        const mutate = vi.fn();
        useRecipePhotosMock.mockReturnValue(photosResult(twoPhotos));
        useDeleteRecipePhotoMock.mockReturnValue(deleteMutation({ mutate: mutate as never }));
        useCreatePhotoUploadUrlMock.mockReturnValue(asyncMutation(presignOk()) as never);
        const confirmMutateAsync = vi.fn();
        useConfirmPhotoUploadMock.mockReturnValue(asyncMutation(confirmMutateAsync) as never);
        fetchMock
            .mockResolvedValueOnce({ blob: async () => new Blob(['bytes'], { type: 'image/jpeg' }) })
            .mockResolvedValueOnce({ ok: false, status: 500 });

        render(<RecipePhotoUploader recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: 'Replace photo 2' }));

        expect(await screen.findByRole('alert', { name: 'Upload failed' })).toBeTruthy();
        expect(confirmMutateAsync).not.toHaveBeenCalled();
        expect(mutate).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Recipe photo 2')).toBeTruthy();
    });

    it('deletes exactly the replaced photo once its replacement has been confirmed, without reordering', async () => {
        const mutate = vi.fn();
        const reorderMutate = vi.fn();
        useRecipePhotosMock.mockReturnValue(photosResult(twoPhotos));
        useDeleteRecipePhotoMock.mockReturnValue(deleteMutation({ mutate: mutate as never }));
        vi.mocked(useReorderRecipePhotos).mockReturnValue({
            mutate: reorderMutate,
            isPending: false,
        } as unknown as ReturnType<typeof useReorderRecipePhotos>);
        const createMutateAsync = presignOk();
        const confirmMutateAsync = vi.fn().mockResolvedValue(makePhoto({ id: 'pht_new', order: 3 }));
        useCreatePhotoUploadUrlMock.mockReturnValue(asyncMutation(createMutateAsync) as never);
        useConfirmPhotoUploadMock.mockReturnValue(asyncMutation(confirmMutateAsync) as never);
        fetchMock
            .mockResolvedValueOnce({ blob: async () => new Blob(['bytes'], { type: 'image/jpeg' }) })
            .mockResolvedValueOnce({ ok: true, status: 200 });

        render(<RecipePhotoUploader recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: 'Replace photo 2' }));

        await waitFor(() => expect(confirmMutateAsync).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));

        expect(mutate).toHaveBeenCalledWith(
            { id: 'rec_1', photoId: 'pht_2' },
            expect.objectContaining({ onError: expect.any(Function) }),
        );
        // The delete is the LAST step — the replacement was already confirmed.
        expect(confirmMutateAsync.mock.invocationCallOrder[0]).toBeLessThan(
            mutate.mock.invocationCallOrder[0] as number,
        );
        // Cover semantics untouched: replacing never reorders.
        expect(reorderMutate).not.toHaveBeenCalled();
    });

    it('refuses to replace at the photo cap — no picker, no delete, an actionable message', async () => {
        const mutate = vi.fn();
        useRecipePhotosMock.mockReturnValue(
            photosResult(Array.from({ length: 10 }, (_unused, index) => makePhoto({ id: `pht_${index + 1}` }))),
        );
        useDeleteRecipePhotoMock.mockReturnValue(deleteMutation({ mutate: mutate as never }));

        render(<RecipePhotoUploader recipeId="rec_1" />);
        fireEvent.click(screen.getByRole('button', { name: 'Replace photo 3' }));

        expect(await screen.findByText('Remove a photo first — replacing needs room for the new one.')).toBeTruthy();
        expect(launchImageLibraryAsyncMock).not.toHaveBeenCalled();
        expect(mutate).not.toHaveBeenCalled();
    });
});

describe('RecipePhotoUploader — Replace counts the drafts a create holds', () => {
    it('refuses to replace when confirmed photos plus pending draft picks fill the cap', () => {
        useRecipePhotosMock.mockReturnValue(
            photosResult(Array.from({ length: 9 }, (_unused, index) => makePhoto({ id: `pht_${index + 1}` }))),
        );

        render(
            <RecipePhotoUploader
                recipeId="rec_1"
                pendingDrafts={[{ fileName: 'draft.jpg', contentType: 'image/jpeg', fileSize: 5 } as never]}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Replace photo 3' }));

        expect(screen.getByText('Remove a photo first — replacing needs room for the new one.')).toBeTruthy();
        expect(launchImageLibraryAsyncMock).not.toHaveBeenCalled();
    });
});

describe('RecipePhotoUploader — photo cap', () => {
    it('hides the add control once the recipe is at the 10-photo cap', () => {
        const photos = Array.from({ length: 10 }, (_unused, index) =>
            makePhoto({ id: `pht_${index + 1}`, order: index + 1 }),
        );
        useRecipePhotosMock.mockReturnValue(photosResult(photos));

        render(<RecipePhotoUploader recipeId="rec_1" />);

        expect(screen.queryByRole('button', { name: 'Add photos' })).toBeNull();
        expect(screen.getByText('Maximum of 10 photos reached.')).toBeTruthy();
    });
});
