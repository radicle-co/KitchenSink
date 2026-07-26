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
    // Per-test knob for the fake `useRecipePhotoUpload` below: when `stuck` is true, an upload flips
    // `uploading: true` and never resolves — simulating a file still mid-flight when the container unmounts.
    uploadState: { stuck: false },
}));

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
                setState({ uploading: false, errorMessage: undefined });
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

describe('RecipePhotoUploaderContainer (web) — replace (U6)', () => {
    it('removes the chosen photo and re-opens the file input so its replacement can be picked', async () => {
        const mutate = vi.fn();
        deletePhotoMock.mockReturnValue({ mutate, isPending: false, variables: undefined });
        photosQueryMock.mockReturnValue({ data: threeConfirmedPhotos });
        const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
        const user = userEvent.setup();
        render(<RecipePhotoUploaderContainer recipeId="rec_1" />);

        await user.click(screen.getByRole('button', { name: 'Replace photo 2' }));

        expect(mutate).toHaveBeenCalledWith({ id: 'rec_1', photoId: 'ph_2' });
        expect(clickSpy).toHaveBeenCalled();
    });
});
