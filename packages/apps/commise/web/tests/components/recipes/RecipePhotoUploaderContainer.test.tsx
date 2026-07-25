// @vitest-environment jsdom
/**
 * Component tests for RecipePhotoUploaderContainer (T067 web recipe-photo wiring, wireframe step 4; w3/e4
 * per-file upload queue grid). The container composes the shared presentational `RecipePhotoManager` block
 * with the `useRecipePhotoUploadQueue` layer over the single-flight `useRecipePhotoUpload` orchestration and
 * the delete-photo mutation. Covers: rendering the recipe's photos from the query; a file selection running
 * presign → direct-PUT → confirm in order with the right args (the S3 PUT carries method `PUT` and the raw
 * file body); a failed direct upload surfacing the file's own FAILED badge + Retry (not a blanket banner —
 * per-file status is the whole point of the queue); the in-flight uploading status while the sequence is
 * pending; picking a SECOND file while the first is still uploading being QUEUED (not rejected — the queue's
 * whole reason to exist) and processed once the first settles, still driving the underlying single-flight
 * hook's presign exactly once at a time (B24 is preserved INSIDE the queue, not at the DOM/container level
 * anymore); retrying a failed file re-driving only that file; removing a failed queue item dropping it;
 * remove invoking the delete mutation with the photo id; and the 10-photo cap hiding the add control. Queries
 * use role/label/text only — no test ids.
 *
 * Migrated (CP-6 T3) off `vi.mock('@kitchensink/recipe-service-client/hooks', ...)` onto the type-checked
 * fake-client seam: `renderWithRecipeClient` mounts the container through the REAL query/mutation hooks over
 * a real, network-guarded `RecipeServiceClient` (`createFakeRecipeServiceClient`), stubbed per test with
 * type-checked `vi.spyOn(client, '<method>')`. `fetch` stays stubbed exactly as before — the raw S3 PUT is
 * orthogonal to the client seam.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecipePhoto } from '@kitchensink/recipe-core';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { UploadUrlResponse } from '@kitchensink/recipe-service-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { RecipePhotoUploaderContainer } from '@/components/recipes/RecipePhotoUploaderContainer';

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

/** Build a complete {@link UploadUrlResponse} with sensible defaults. */
function makeUploadUrlResponse(overrides: Partial<UploadUrlResponse> = {}): UploadUrlResponse {
    return {
        uploadUrl: UPLOAD_URL,
        key: OBJECT_KEY,
        expiresIn: 900,
        maxBytes: 5 * 1024 * 1024,
        ...overrides,
    };
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
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
});

describe('RecipePhotoUploaderContainer', () => {
    it('renders the recipe photos from the query', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipePhotos').mockResolvedValue([makeRecipePhoto({ id: 'photo_1', order: 1 })]);

        renderWithRecipeClient(<RecipePhotoUploaderContainer recipeId="rec_1" />, client);

        expect(await screen.findByRole('img', { name: 'Recipe photo 1' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove photo 1' })).toBeInTheDocument();
    });

    it('runs presign → PUT → confirm in order with the right args when a file is selected', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipePhotos').mockResolvedValue([]);
        const presign = vi.spyOn(client, 'createPhotoUploadUrl').mockResolvedValue(makeUploadUrlResponse());
        const confirm = vi.spyOn(client, 'confirmPhotoUpload').mockResolvedValue(makeRecipePhoto());
        const fetchMock = stubFetch(true);

        renderWithRecipeClient(<RecipePhotoUploaderContainer recipeId="rec_1" />, client);

        const file = new File(['bytes'], 'dinner.png', { type: 'image/png' });
        const input = await screen.findByLabelText('Add photo');
        await user.upload(input, file);

        await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));

        // Step 1: presign with the file's name / content type / size.
        expect(presign).toHaveBeenCalledWith('rec_1', {
            fileName: 'dinner.png',
            contentType: 'image/png',
            fileSize: file.size,
        });
        // Step 2: a direct PUT of the raw file body to the presigned URL (the hook also passes an
        // AbortController signal, used for abort-on-unmount — not part of this contract).
        expect(fetchMock).toHaveBeenCalledWith(
            UPLOAD_URL,
            expect.objectContaining({
                method: 'PUT',
                body: file,
                headers: { 'Content-Type': 'image/png' },
            }),
        );
        // Step 3: confirm with the presigned key + content type.
        expect(confirm).toHaveBeenCalledWith('rec_1', { key: OBJECT_KEY, contentType: 'image/png' });
        // Ordering: presign before the PUT before the confirm.
        expect(presign.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
        expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(confirm.mock.invocationCallOrder[0]);
        // The input is reset so the same file can be re-picked.
        expect((input as HTMLInputElement).value).toBe('');
    });

    it('surfaces the file’s own FAILED badge + Retry when the direct upload fails (not a blanket banner)', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipePhotos').mockResolvedValue([]);
        vi.spyOn(client, 'createPhotoUploadUrl').mockResolvedValue(makeUploadUrlResponse());
        const confirm = vi.spyOn(client, 'confirmPhotoUpload').mockResolvedValue(makeRecipePhoto());
        stubFetch(false);

        renderWithRecipeClient(<RecipePhotoUploaderContainer recipeId="rec_1" />, client);

        const file = new File(['bytes'], 'dinner.png', { type: 'image/png' });
        await user.upload(await screen.findByLabelText('Add photo'), file);

        expect(await screen.findByRole('alert', { name: 'Upload failed' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry upload of dinner.png' })).toBeInTheDocument();
        // A failed direct upload never confirms.
        expect(confirm).not.toHaveBeenCalled();
        // The uploading busy status is cleared.
        expect(screen.queryByRole('status', { name: 'Uploading photo' })).not.toBeInTheDocument();
    });

    it('retries only the failed file, flipping it to uploading then folding it into the confirmed photos', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipePhotos').mockResolvedValue([]);
        const presign = vi
            .spyOn(client, 'createPhotoUploadUrl')
            .mockResolvedValueOnce(makeUploadUrlResponse())
            .mockResolvedValueOnce(makeUploadUrlResponse());
        const confirm = vi.spyOn(client, 'confirmPhotoUpload').mockResolvedValue(makeRecipePhoto());
        const fetchMock = stubFetch(false);

        renderWithRecipeClient(<RecipePhotoUploaderContainer recipeId="rec_1" />, client);

        const file = new File(['bytes'], 'dinner.png', { type: 'image/png' });
        await user.upload(await screen.findByLabelText('Add photo'), file);
        await screen.findByRole('alert', { name: 'Upload failed' });

        fetchMock.mockResolvedValue({ ok: true, status: 200 });
        await user.click(screen.getByRole('button', { name: 'Retry upload of dinner.png' }));

        await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
        expect(presign).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('alert', { name: 'Upload failed' })).not.toBeInTheDocument();
    });

    it('removes a failed queue item without touching the delete-photo mutation', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipePhotos').mockResolvedValue([]);
        vi.spyOn(client, 'createPhotoUploadUrl').mockResolvedValue(makeUploadUrlResponse());
        vi.spyOn(client, 'confirmPhotoUpload').mockResolvedValue(makeRecipePhoto());
        const del = vi.spyOn(client, 'deleteRecipePhoto');
        stubFetch(false);

        renderWithRecipeClient(<RecipePhotoUploaderContainer recipeId="rec_1" />, client);

        const file = new File(['bytes'], 'dinner.png', { type: 'image/png' });
        await user.upload(await screen.findByLabelText('Add photo'), file);
        await screen.findByRole('alert', { name: 'Upload failed' });

        await user.click(screen.getByRole('button', { name: 'Remove dinner.png' }));

        expect(screen.queryByRole('alert', { name: 'Upload failed' })).not.toBeInTheDocument();
        expect(del).not.toHaveBeenCalled();
    });

    it('shows the uploading status while the upload sequence is in flight', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipePhotos').mockResolvedValue([]);
        let resolvePresign: (value: UploadUrlResponse) => void = () => undefined;
        const presign = vi.spyOn(client, 'createPhotoUploadUrl').mockReturnValue(
            new Promise<UploadUrlResponse>((resolve) => {
                resolvePresign = resolve;
            }),
        );
        vi.spyOn(client, 'confirmPhotoUpload').mockResolvedValue(makeRecipePhoto());
        stubFetch(true);

        renderWithRecipeClient(<RecipePhotoUploaderContainer recipeId="rec_1" />, client);

        const file = new File(['bytes'], 'dinner.png', { type: 'image/png' });
        await user.upload(await screen.findByLabelText('Add photo'), file);

        // Presign is still pending → the block shows its uploading busy status.
        expect(await screen.findByRole('status', { name: 'Uploading photo' })).toBeInTheDocument();

        resolvePresign(makeUploadUrlResponse());

        await waitFor(() => expect(screen.queryByRole('status', { name: 'Uploading photo' })).not.toBeInTheDocument());
        expect(presign).toHaveBeenCalledTimes(1);
    });

    it('queues a second file pick while the first is uploading (w3/e4) instead of rejecting it', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipePhotos').mockResolvedValue([]);
        let resolveFirstPresign: (value: UploadUrlResponse) => void = () => undefined;
        const presign = vi
            .spyOn(client, 'createPhotoUploadUrl')
            .mockImplementationOnce(
                () =>
                    new Promise<UploadUrlResponse>((resolve) => {
                        resolveFirstPresign = resolve;
                    }),
            )
            .mockResolvedValue(makeUploadUrlResponse({ key: 'recipes/rec_1/second.png' }));
        const confirm = vi.spyOn(client, 'confirmPhotoUpload').mockResolvedValue(makeRecipePhoto());
        stubFetch(true);

        renderWithRecipeClient(<RecipePhotoUploaderContainer recipeId="rec_1" />, client);

        const input = await screen.findByLabelText('Add photo');
        // The input accepts multiple files — the add control is never disabled while uploading, since a
        // second pick now QUEUES rather than being rejected at the DOM (the old B24-at-the-container guard;
        // B24 itself still holds — see `useRecipePhotoUpload.test.tsx` — just enforced inside the queue now).
        expect(input).not.toBeDisabled();

        const firstFile = new File(['bytes'], 'dinner.png', { type: 'image/png' });
        await user.upload(input, firstFile);
        expect(presign).toHaveBeenCalledTimes(1);

        const secondFile = new File(['more-bytes'], 'lunch.png', { type: 'image/png' });
        await user.upload(input, secondFile);

        // The second file is QUEUED, not started — its presign must not have fired yet.
        expect(presign).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('status', { name: 'Queued' })).toBeInTheDocument();

        resolveFirstPresign(makeUploadUrlResponse());
        await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));

        // ONLY once the first settled did the second file's presign fire.
        await waitFor(() => expect(presign).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
        expect(confirm).toHaveBeenNthCalledWith(1, 'rec_1', { key: OBJECT_KEY, contentType: 'image/png' });
        expect(confirm).toHaveBeenNthCalledWith(2, 'rec_1', {
            key: 'recipes/rec_1/second.png',
            contentType: 'image/png',
        });
    });

    it('removes a photo by invoking the delete mutation with the photo id', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipePhotos').mockResolvedValue([makeRecipePhoto({ id: 'photo_42', order: 1 })]);
        const del = vi.spyOn(client, 'deleteRecipePhoto').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<RecipePhotoUploaderContainer recipeId="rec_1" />, client);

        await user.click(await screen.findByRole('button', { name: 'Remove photo 1' }));

        expect(del).toHaveBeenCalledWith('rec_1', 'photo_42');
    });

    it('busies the removing photo row from the delete mutation’s in-flight variables', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipePhotos').mockResolvedValue([makeRecipePhoto({ id: 'photo_42', order: 1 })]);
        vi.spyOn(client, 'deleteRecipePhoto').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<RecipePhotoUploaderContainer recipeId="rec_1" />, client);

        await user.click(await screen.findByRole('button', { name: 'Remove photo 1' }));

        expect(await screen.findByRole('button', { name: 'Remove photo 1' })).toHaveAttribute('aria-busy', 'true');
    });

    it('hides the add control at the 10-photo cap', async () => {
        const client = createFakeRecipeServiceClient();
        const photos = Array.from({ length: 10 }, (_unused, index) =>
            makeRecipePhoto({ id: `photo_${index + 1}`, order: index + 1 }),
        );
        vi.spyOn(client, 'listRecipePhotos').mockResolvedValue(photos);

        renderWithRecipeClient(<RecipePhotoUploaderContainer recipeId="rec_1" />, client);

        expect(await screen.findByText(/maximum of 10 photos reached/i)).toBeInTheDocument();
        expect(screen.queryByLabelText('Add photo')).not.toBeInTheDocument();
    });
});
