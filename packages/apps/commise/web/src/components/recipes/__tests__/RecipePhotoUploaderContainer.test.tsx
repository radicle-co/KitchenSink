// @vitest-environment jsdom
/**
 * Component/characterization tests for `RecipePhotoUploaderContainer` (B14 — CP-9 Task 11).
 *
 * This container carries two refs, BOTH kept as legitimate allowed refs per CLAUDE.md §3 (documented at
 * their declaration): `inputRef` wraps the hidden `<input type="file">` DOM node — the only way to reset a
 * file input so the same file can be re-picked — and `previewUrlsRef` is external-resource-lifecycle
 * bookkeeping for `URL.createObjectURL`/`revokeObjectURL` (never read to drive rendering; the grid renders
 * each item's preview from the queue hook's own `previewUri` state). Neither is the render-mutated /
 * state-in-a-ref smell this task eliminates elsewhere. These tests pin the observable behavior those refs
 * exist to support, so a future "simplify away the ref" change that breaks it fails loudly:
 *  - the hidden input (reached via its label) is the add control — `type=file`, `multiple`, `hidden`;
 *  - picking files enqueues each one with a minted preview URL and resets the input's value;
 *  - a file's preview URL is revoked once its upload resolves and the item leaves the "pending" set;
 *  - every still-tracked preview URL is revoked on unmount (a file still mid-flight when the user navigates
 *    away must not leak its object URL).
 *
 * They also pin U6's CANCEL-SAFE replace (upload-first, then swap): pressing Replace opens the dedicated
 * replacement picker WITHOUT deleting anything, a cancelled dialog (no `change` event) and a failed upload
 * both leave the original photo intact, a confirmed replacement deletes exactly the replaced photo (and never
 * reorders, so the lowest-sort-order cover rule is untouched), and Replace at the photo cap refuses with
 * actionable copy instead of destroying the original for a swap that cannot land.
 *
 * `useRecipePhotos` / `useDeleteRecipePhoto` (network/query hooks) and `useRecipePhotoUpload` (the
 * presign→PUT→confirm orchestration) are replaced with lightweight doubles — this container's own
 * responsibility is the DOM wiring around them, not re-proving their internals (covered where they're
 * defined). The real `useRecipePhotoUploadQueue` is used un-mocked so the queued→uploading→ok lifecycle the
 * cleanup effect reacts to is authentic, not asserted-via-mock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback, useState } from 'react';

const { photosQueryMock, deletePhotoMock, reorderPhotoMock, uploadState } = vi.hoisted(() => ({
    photosQueryMock: vi.fn(),
    deletePhotoMock: vi.fn(),
    reorderPhotoMock: vi.fn(),
    // Per-test knobs for the fake `useRecipePhotoUpload` below: `stuck` flips `uploading: true` and never
    // resolves (a file still mid-flight when the container unmounts / while a swap must stay uncommitted);
    // `fail` settles the upload with an error message (the queue then marks that file `failed`).
    uploadState: { stuck: false, fail: false },
}));

/** The localized upload error the fake uploader settles with when `uploadState.fail` is set. */
const UPLOAD_FAILED_MESSAGE = 'We couldn’t upload your photo. Please try again.';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipePhotos: photosQueryMock,
    useDeleteRecipePhoto: deletePhotoMock,
    useReorderRecipePhotos: reorderPhotoMock,
}));

vi.mock('@commise/features-recipes/hooks', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@commise/features-recipes/hooks')>();

    return {
        ...actual,
        // A minimal but REAL (stateful) stand-in for the single-flight upload hook, so the real
        // `useRecipePhotoUploadQueue` composed on top of it drives an authentic queued→uploading→ok/stuck
        // lifecycle instead of a hand-asserted mock sequence.
        useRecipePhotoUpload: () => {
            const [state, setState] = useState<{ uploading: boolean; errorMessage: string | undefined }>({
                uploading: false,
                errorMessage: undefined,
            });

            const upload = useCallback(async () => {
                setState({ uploading: true, errorMessage: undefined });

                if (uploadState.stuck) {
                    return; // never resolves — the item stays 'uploading' (pending) forever
                }

                await Promise.resolve();
                setState({
                    uploading: false,
                    errorMessage: uploadState.fail ? UPLOAD_FAILED_MESSAGE : undefined,
                });
            }, []);

            return { ...state, upload };
        },
    };
});

const { RecipePhotoUploaderContainer } = await import('../RecipePhotoUploaderContainer.js');

const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();

function makeFile(name: string): File {
    return new File(['x'], name, { type: 'image/png' });
}

beforeEach(() => {
    let nextUrl = 0;
    createObjectURL.mockReset().mockImplementation(() => `blob:preview-${(nextUrl += 1)}`);
    revokeObjectURL.mockReset();
    (URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: typeof revokeObjectURL }).revokeObjectURL = revokeObjectURL;

    uploadState.stuck = false;
    uploadState.fail = false;
    photosQueryMock.mockReset().mockReturnValue({ data: [] });
    deletePhotoMock.mockReset().mockReturnValue({ mutate: vi.fn(), isPending: false, variables: undefined });
    reorderPhotoMock.mockReset().mockReturnValue({ mutate: vi.fn(), isPending: false, variables: undefined });
});

const threeConfirmedPhotos = [
    { id: 'ph_1', url: 'https://cdn.example/1.jpg', order: 1, recipeId: 'rec_1', createdAt: '' },
    { id: 'ph_2', url: 'https://cdn.example/2.jpg', order: 2, recipeId: 'rec_1', createdAt: '' },
    { id: 'ph_3', url: 'https://cdn.example/3.jpg', order: 3, recipeId: 'rec_1', createdAt: '' },
];

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('RecipePhotoUploaderContainer (web) — the add control (inputRef)', () => {
    it('renders the hidden, multi-select file input as the labeled add control', () => {
        render(<RecipePhotoUploaderContainer recipeId="rec_1" />);

        const input = screen.getByLabelText('Add photo') as HTMLInputElement;
        expect(input.type).toBe('file');
        expect(input.multiple).toBe(true);
        expect(input.hidden).toBe(true);
        expect(input.accept).toBe('image/*');
    });

    it('enqueues every picked file with a minted preview URL and resets the input', async () => {
        // Stuck (never-resolving) upload so the queued item stays visible (not folded into the confirmed
        // `photos` list) long enough to assert its render — the enqueue mechanics are what this test pins,
        // not the upload's own resolution (covered by the cleanup tests below).
        uploadState.stuck = true;
        const user = userEvent.setup();
        render(<RecipePhotoUploaderContainer recipeId="rec_1" />);

        const input = screen.getByLabelText('Add photo') as HTMLInputElement;
        const file = makeFile('a.png');
        await user.upload(input, file);

        expect(createObjectURL).toHaveBeenCalledWith(file);
        expect(input.value).toBe('');
        expect(await screen.findByRole('img', { name: 'Photo a.png' })).toBeTruthy();
    });

    it('enqueues multiple picked files together', async () => {
        uploadState.stuck = true;
        const user = userEvent.setup();
        render(<RecipePhotoUploaderContainer recipeId="rec_1" />);

        const input = screen.getByLabelText('Add photo') as HTMLInputElement;
        const files = [makeFile('a.png'), makeFile('b.png')];
        await user.upload(input, files);

        expect(createObjectURL).toHaveBeenCalledTimes(2);
        expect(await screen.findByRole('img', { name: 'Photo a.png' })).toBeTruthy();
        expect(screen.getByRole('img', { name: 'Photo b.png' })).toBeTruthy();
    });
});

describe('RecipePhotoUploaderContainer (web) — preview URL cleanup (previewUrlsRef)', () => {
    it("revokes a file's preview URL once its upload resolves (no longer pending)", async () => {
        const user = userEvent.setup();
        render(<RecipePhotoUploaderContainer recipeId="rec_1" />);

        const input = screen.getByLabelText('Add photo') as HTMLInputElement;
        await user.upload(input, makeFile('a.png'));

        const mintedUrl = createObjectURL.mock.results[0]?.value as string;
        await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith(mintedUrl));
    });

    it('does NOT revoke a preview URL while its file is still mid-flight (uploading)', async () => {
        uploadState.stuck = true;
        const user = userEvent.setup();
        render(<RecipePhotoUploaderContainer recipeId="rec_1" />);

        const input = screen.getByLabelText('Add photo') as HTMLInputElement;
        await user.upload(input, makeFile('stuck.png'));

        await waitFor(() => expect(screen.getByRole('status', { name: 'Uploading…' })).toBeTruthy());
        expect(revokeObjectURL).not.toHaveBeenCalled();
    });

    it('revokes every still-tracked preview URL on unmount (a file still mid-flight when navigating away)', async () => {
        uploadState.stuck = true;
        const user = userEvent.setup();
        const { unmount } = render(<RecipePhotoUploaderContainer recipeId="rec_1" />);

        const input = screen.getByLabelText('Add photo') as HTMLInputElement;
        await user.upload(input, makeFile('stuck.png'));
        await waitFor(() => expect(screen.getByRole('status', { name: 'Uploading…' })).toBeTruthy());

        const mintedUrl = createObjectURL.mock.results[0]?.value as string;
        expect(revokeObjectURL).not.toHaveBeenCalled();

        act(() => unmount());

        expect(revokeObjectURL).toHaveBeenCalledWith(mintedUrl);
    });
});

describe('RecipePhotoUploaderContainer (web) — delete', () => {
    it('deletes a confirmed photo through useDeleteRecipePhoto, scoped to this recipe', async () => {
        const mutate = vi.fn();
        deletePhotoMock.mockReturnValue({ mutate, isPending: false, variables: undefined });
        photosQueryMock.mockReturnValue({
            data: [{ id: 'ph_1', url: 'https://cdn.example/1.jpg', order: 1, recipeId: 'rec_1', createdAt: '' }],
        });
        const user = userEvent.setup();
        render(<RecipePhotoUploaderContainer recipeId="rec_1" />);

        await user.click(screen.getByRole('button', { name: 'Remove photo 1' }));

        expect(mutate).toHaveBeenCalledWith({ id: 'rec_1', photoId: 'ph_1' });
    });
});

describe('RecipePhotoUploaderContainer (web) — set cover (U6)', () => {
    it('reorders the chosen photo to index 0 (cover = lowest sort order), rest keeping their order', async () => {
        const mutate = vi.fn();
        reorderPhotoMock.mockReturnValue({ mutate, isPending: false, variables: undefined });
        photosQueryMock.mockReturnValue({ data: threeConfirmedPhotos });
        const user = userEvent.setup();
        render(<RecipePhotoUploaderContainer recipeId="rec_1" />);

        // ph_1 is the current cover (index 0, checked); choosing ph_3 must move it to the front.
        await user.click(screen.getByRole('radio', { name: 'Set photo 3 as cover' }));

        expect(mutate).toHaveBeenCalledWith({ id: 'rec_1', photoIds: ['ph_3', 'ph_1', 'ph_2'] });
    });
});

describe('RecipePhotoUploaderContainer (web) — cancel-safe replace (U6)', () => {
    /** Arrange the three-photo recipe + a delete double, and open the replacement picker for `photoIndex`. */
    async function startReplace(photoIndex: number): Promise<{
        deleteMutate: ReturnType<typeof vi.fn>;
        reorderMutate: ReturnType<typeof vi.fn>;
        clickSpy: ReturnType<typeof vi.spyOn>;
        user: ReturnType<typeof userEvent.setup>;
    }> {
        const deleteMutate = vi.fn();
        const reorderMutate = vi.fn();
        deletePhotoMock.mockReturnValue({ mutate: deleteMutate, isPending: false, variables: undefined });
        reorderPhotoMock.mockReturnValue({ mutate: reorderMutate, isPending: false, variables: undefined });
        photosQueryMock.mockReturnValue({ data: threeConfirmedPhotos });
        // `.click()` on a hidden file input would try to open a real dialog jsdom has no notion of; the pick
        // itself is simulated by firing a change on that same input (or NOT firing one, to model a cancel).
        const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
        const user = userEvent.setup();
        render(<RecipePhotoUploaderContainer recipeId="rec_1" />);

        await user.click(screen.getByRole('button', { name: `Replace photo ${photoIndex}` }));

        return { deleteMutate, reorderMutate, clickSpy, user };
    }

    it('opens the replacement picker WITHOUT deleting anything first', async () => {
        const { deleteMutate, clickSpy } = await startReplace(2);

        // The regression this pins: the old wiring deleted the photo up-front, so the original was already
        // gone before the user had picked (or cancelled) anything.
        expect(clickSpy).toHaveBeenCalled();
        expect(deleteMutate).not.toHaveBeenCalled();
        expect(screen.getByRole('img', { name: 'Recipe photo 2' })).toBeTruthy();
    });

    it('leaves the original untouched when the user CANCELS the picker (no change event)', async () => {
        const { deleteMutate } = await startReplace(2);

        // A cancelled file dialog fires no `change` — nothing at all should have happened.
        expect(deleteMutate).not.toHaveBeenCalled();
        expect(screen.getByRole('img', { name: 'Recipe photo 1' })).toBeTruthy();
        expect(screen.getByRole('img', { name: 'Recipe photo 2' })).toBeTruthy();
        expect(screen.getByRole('img', { name: 'Recipe photo 3' })).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('does not delete the original while the replacement upload is still in flight', async () => {
        uploadState.stuck = true;
        const { deleteMutate, user } = await startReplace(2);

        await user.upload(screen.getByLabelText('Choose a replacement photo'), makeFile('new.png'));

        await waitFor(() => expect(screen.getByRole('status', { name: 'Uploading…' })).toBeTruthy());
        expect(deleteMutate).not.toHaveBeenCalled();
        expect(screen.getByRole('img', { name: 'Recipe photo 2' })).toBeTruthy();
    });

    it('leaves the original untouched when the replacement upload FAILS', async () => {
        uploadState.fail = true;
        const { deleteMutate, user } = await startReplace(2);

        await user.upload(screen.getByLabelText('Choose a replacement photo'), makeFile('new.png'));

        await waitFor(() => expect(screen.getByRole('alert', { name: 'Upload failed' })).toBeTruthy());
        expect(deleteMutate).not.toHaveBeenCalled();
        expect(screen.getByRole('img', { name: 'Recipe photo 2' })).toBeTruthy();
    });

    it('deletes exactly the replaced photo once its replacement has been confirmed', async () => {
        const { deleteMutate, reorderMutate, user } = await startReplace(2);

        await user.upload(screen.getByLabelText('Choose a replacement photo'), makeFile('new.png'));

        await waitFor(() => expect(deleteMutate).toHaveBeenCalledTimes(1));
        expect(deleteMutate).toHaveBeenCalledWith({ id: 'rec_1', photoId: 'ph_2' });
        // Cover semantics are untouched by a replace: the cover is still resolved as the lowest-sort-order
        // photo, so replacing one never reorders (and never silently reassigns the cover).
        expect(reorderMutate).not.toHaveBeenCalled();
        expect(screen.getByRole('radio', { name: 'Set photo 1 as cover' })).toBeChecked();
    });

    it('replaces the COVER photo without reordering — the cover stays the lowest-sort-order photo', async () => {
        const { deleteMutate, reorderMutate, user } = await startReplace(1);

        await user.upload(screen.getByLabelText('Choose a replacement photo'), makeFile('new-cover.png'));

        await waitFor(() => expect(deleteMutate).toHaveBeenCalledTimes(1));
        expect(deleteMutate).toHaveBeenCalledWith({ id: 'rec_1', photoId: 'ph_1' });
        expect(reorderMutate).not.toHaveBeenCalled();
    });

    it('refuses to replace at the photo cap (a lossless swap needs a free slot) and deletes nothing', async () => {
        const deleteMutate = vi.fn();
        deletePhotoMock.mockReturnValue({ mutate: deleteMutate, isPending: false, variables: undefined });
        photosQueryMock.mockReturnValue({
            data: Array.from({ length: 10 }, (_unused, index) => ({
                id: `ph_${index + 1}`,
                url: `https://cdn.example/${index + 1}.jpg`,
                order: index + 1,
                recipeId: 'rec_1',
                createdAt: '',
            })),
        });
        const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
        const user = userEvent.setup();
        render(<RecipePhotoUploaderContainer recipeId="rec_1" />);

        await user.click(screen.getByRole('button', { name: 'Replace photo 3' }));

        expect(screen.getByRole('alert')).toHaveTextContent(
            'Remove a photo first — replacing needs room for the new one.',
        );
        expect(deleteMutate).not.toHaveBeenCalled();
        expect(clickSpy).not.toHaveBeenCalled();
    });
});
