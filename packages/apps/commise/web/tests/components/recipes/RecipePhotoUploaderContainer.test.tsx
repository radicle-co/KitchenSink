// @vitest-environment jsdom
/**
 * Component tests for RecipePhotoUploaderContainer (T067 web recipe-photo wiring, wireframe step 4). The
 * container composes the shared presentational `RecipePhotoManager` block with the presign → PUT → confirm
 * upload orchestration and the delete-photo mutation. Covers: rendering the recipe's photos from the query;
 * a file selection running presign → direct-PUT → confirm in order with the right args (the S3 PUT carries
 * method `PUT` and the raw file body); a failed direct upload surfacing a localized error and clearing the
 * uploading state; the in-flight uploading status while the sequence is pending; remove invoking the delete
 * mutation with the photo id; and the 10-photo cap hiding the add control. The recipe-service photo hooks
 * are mocked and `fetch` is stubbed. Queries use role/label/text only — no test ids.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecipePhoto } from '@kitchensink/recipe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecipePhotoUploaderContainer } from '@/components/recipes/RecipePhotoUploaderContainer';

const { useRecipePhotosMock, useCreatePhotoUploadUrlMock, useConfirmPhotoUploadMock, useDeleteRecipePhotoMock } =
    vi.hoisted(() => ({
        useRecipePhotosMock: vi.fn(),
        useCreatePhotoUploadUrlMock: vi.fn(),
        useConfirmPhotoUploadMock: vi.fn(),
        useDeleteRecipePhotoMock: vi.fn(),
    }));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipePhotos: useRecipePhotosMock,
    useCreatePhotoUploadUrl: useCreatePhotoUploadUrlMock,
    useConfirmPhotoUpload: useConfirmPhotoUploadMock,
    useDeleteRecipePhoto: useDeleteRecipePhotoMock,
}));

/** Build a complete {@link RecipePhoto} with sensible defaults. */
function makeRecipePhoto(overrides: Partial<RecipePhoto> = {}): RecipePhoto {
    return {
        id: 'photo_1',
        recipeId: 'rec_1',
        key: 'recipes/rec_1/photo_1.jpg',
        url: 'https://cdn.example.com/recipes/rec_1/photo_1.jpg',
        contentType: 'image/jpeg',
        order: 1,
        createdAt: '2026-04-01T09:00:00.000Z',
        ...overrides,
    };
}

/** A photos query in its resolved state carrying `photos`. */
function photosQuery(photos: readonly RecipePhoto[]): Record<string, unknown> {
    return { data: photos, isLoading: false, isError: false };
}

/** A presign mutation whose `mutateAsync` resolves to a presigned S3 target. */
function presignMutation(mutateAsync = vi.fn().mockResolvedValue({ uploadUrl: UPLOAD_URL, key: OBJECT_KEY })) {
    return { mutateAsync, isPending: false };
}

/** A confirm mutation whose `mutateAsync` resolves to the stored photo. */
function confirmMutation(mutateAsync = vi.fn().mockResolvedValue(makeRecipePhoto())) {
    return { mutateAsync, isPending: false };
}

/** A delete mutation exposing `mutate` + in-flight `variables` (drives `removingPhotoId`). */
function deleteMutation(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return { mutate: vi.fn(), isPending: false, variables: undefined, ...overrides };
}

const UPLOAD_URL = 'https://s3.example.com/upload/presigned';
const OBJECT_KEY = 'recipes/rec_1/new-photo.png';

/** Stub `global.fetch` with a response of the given ok-ness. */
function stubFetch(ok: boolean): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500 });
    vi.stubGlobal('fetch', fetchMock);

    return fetchMock;
}

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
});

describe('RecipePhotoUploaderContainer', () => {
    it('renders the recipe photos from the query', () => {
        useRecipePhotosMock.mockReturnValue(photosQuery([makeRecipePhoto({ id: 'photo_1', order: 1 })]));
        useCreatePhotoUploadUrlMock.mockReturnValue(presignMutation());
        useConfirmPhotoUploadMock.mockReturnValue(confirmMutation());
        useDeleteRecipePhotoMock.mockReturnValue(deleteMutation());

        render(<RecipePhotoUploaderContainer recipeId="rec_1" />);

        expect(screen.getByRole('img', { name: 'Recipe photo 1' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove photo 1' })).toBeInTheDocument();
    });

    it('runs presign → PUT → confirm in order with the right args when a file is selected', async () => {
        const user = userEvent.setup();
        const presign = vi.fn().mockResolvedValue({ uploadUrl: UPLOAD_URL, key: OBJECT_KEY });
        const confirm = vi.fn().mockResolvedValue(makeRecipePhoto());
        const fetchMock = stubFetch(true);

        useRecipePhotosMock.mockReturnValue(photosQuery([]));
        useCreatePhotoUploadUrlMock.mockReturnValue(presignMutation(presign));
        useConfirmPhotoUploadMock.mockReturnValue(confirmMutation(confirm));
        useDeleteRecipePhotoMock.mockReturnValue(deleteMutation());

        render(<RecipePhotoUploaderContainer recipeId="rec_1" />);

        const file = new File(['bytes'], 'dinner.png', { type: 'image/png' });
        const input = screen.getByLabelText('Add photo');
        await user.upload(input, file);

        await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));

        // Step 1: presign with the file's name / content type / size.
        expect(presign).toHaveBeenCalledWith({
            id: 'rec_1',
            request: { fileName: 'dinner.png', contentType: 'image/png', fileSize: file.size },
        });
        // Step 2: a direct PUT of the raw file body to the presigned URL.
        expect(fetchMock).toHaveBeenCalledWith(UPLOAD_URL, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': 'image/png' },
        });
        // Step 3: confirm with the presigned key + content type.
        expect(confirm).toHaveBeenCalledWith({
            id: 'rec_1',
            request: { key: OBJECT_KEY, contentType: 'image/png' },
        });
        // Ordering: presign before the PUT before the confirm.
        expect(presign.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
        expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(confirm.mock.invocationCallOrder[0]);
        // The input is reset so the same file can be re-picked.
        expect((input as HTMLInputElement).value).toBe('');
    });

    it('surfaces a localized error and clears uploading when the direct upload fails', async () => {
        const user = userEvent.setup();
        const confirm = vi.fn().mockResolvedValue(makeRecipePhoto());
        stubFetch(false);

        useRecipePhotosMock.mockReturnValue(photosQuery([]));
        useCreatePhotoUploadUrlMock.mockReturnValue(presignMutation());
        useConfirmPhotoUploadMock.mockReturnValue(confirmMutation(confirm));
        useDeleteRecipePhotoMock.mockReturnValue(deleteMutation());

        render(<RecipePhotoUploaderContainer recipeId="rec_1" />);

        const file = new File(['bytes'], 'dinner.png', { type: 'image/png' });
        await user.upload(screen.getByLabelText('Add photo'), file);

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/couldn.t upload that photo/i);
        // A failed direct upload never confirms.
        expect(confirm).not.toHaveBeenCalled();
        // The uploading busy status is cleared.
        expect(screen.queryByRole('status', { name: 'Uploading photo' })).not.toBeInTheDocument();
    });

    it('shows the uploading status while the upload sequence is in flight', async () => {
        const user = userEvent.setup();
        let resolvePresign: (value: { uploadUrl: string; key: string }) => void = () => undefined;
        const presign = vi.fn().mockReturnValue(
            new Promise<{ uploadUrl: string; key: string }>((resolve) => {
                resolvePresign = resolve;
            }),
        );
        stubFetch(true);

        useRecipePhotosMock.mockReturnValue(photosQuery([]));
        useCreatePhotoUploadUrlMock.mockReturnValue(presignMutation(presign));
        useConfirmPhotoUploadMock.mockReturnValue(confirmMutation());
        useDeleteRecipePhotoMock.mockReturnValue(deleteMutation());

        render(<RecipePhotoUploaderContainer recipeId="rec_1" />);

        const file = new File(['bytes'], 'dinner.png', { type: 'image/png' });
        await user.upload(screen.getByLabelText('Add photo'), file);

        // Presign is still pending → the block shows its uploading busy status.
        expect(await screen.findByRole('status', { name: 'Uploading photo' })).toBeInTheDocument();

        resolvePresign({ uploadUrl: UPLOAD_URL, key: OBJECT_KEY });

        await waitFor(() => expect(screen.queryByRole('status', { name: 'Uploading photo' })).not.toBeInTheDocument());
    });

    it('removes a photo by invoking the delete mutation with the photo id', async () => {
        const user = userEvent.setup();
        const del = deleteMutation();

        useRecipePhotosMock.mockReturnValue(photosQuery([makeRecipePhoto({ id: 'photo_42', order: 1 })]));
        useCreatePhotoUploadUrlMock.mockReturnValue(presignMutation());
        useConfirmPhotoUploadMock.mockReturnValue(confirmMutation());
        useDeleteRecipePhotoMock.mockReturnValue(del);

        render(<RecipePhotoUploaderContainer recipeId="rec_1" />);

        await user.click(screen.getByRole('button', { name: 'Remove photo 1' }));

        expect(del['mutate']).toHaveBeenCalledWith({ id: 'rec_1', photoId: 'photo_42' });
    });

    it('busies the removing photo row from the delete mutation’s in-flight variables', () => {
        useRecipePhotosMock.mockReturnValue(photosQuery([makeRecipePhoto({ id: 'photo_42', order: 1 })]));
        useCreatePhotoUploadUrlMock.mockReturnValue(presignMutation());
        useConfirmPhotoUploadMock.mockReturnValue(confirmMutation());
        useDeleteRecipePhotoMock.mockReturnValue(
            deleteMutation({ isPending: true, variables: { id: 'rec_1', photoId: 'photo_42' } }),
        );

        render(<RecipePhotoUploaderContainer recipeId="rec_1" />);

        expect(screen.getByRole('button', { name: 'Remove photo 1' })).toHaveAttribute('aria-busy', 'true');
    });

    it('hides the add control at the 10-photo cap', () => {
        const photos = Array.from({ length: 10 }, (_unused, index) =>
            makeRecipePhoto({ id: `photo_${index + 1}`, order: index + 1 }),
        );
        useRecipePhotosMock.mockReturnValue(photosQuery(photos));
        useCreatePhotoUploadUrlMock.mockReturnValue(presignMutation());
        useConfirmPhotoUploadMock.mockReturnValue(confirmMutation());
        useDeleteRecipePhotoMock.mockReturnValue(deleteMutation());

        render(<RecipePhotoUploaderContainer recipeId="rec_1" />);

        expect(screen.queryByLabelText('Add photo')).not.toBeInTheDocument();
        expect(screen.getByText(/maximum of 10 photos reached/i)).toBeInTheDocument();
    });
});
