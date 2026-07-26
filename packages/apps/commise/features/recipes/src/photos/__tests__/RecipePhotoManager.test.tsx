// @vitest-environment jsdom
/**
 * Component tests for the web recipe photo manager (T067). Covers every state the block renders — empty,
 * populated (grid + per-photo remove), a per-photo removing-busy state, the upload-in-flight status, the
 * error alert, and the add-control visibility around the photo cap. Assertions are on role/label/text and
 * mock-call args, so a wrong branch or dropped handler argument fails the test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { makePhoto, makeQueueItem } from '../../__fixtures__/index.js';
import { RecipePhotoManager } from '../RecipePhotoManager.js';
import { MAX_RECIPE_PHOTOS, type RecipePhotoManagerProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderManager(overrides: Partial<RecipePhotoManagerProps> = {}) {
    const props: RecipePhotoManagerProps = {
        photos: [],
        onRemovePhoto: noop,
        ...overrides,
    };
    render(<RecipePhotoManager {...props} />);

    return props;
}

const threePhotos = [
    makePhoto({ id: 'ph_1', url: 'https://cdn.example/1.jpg', order: 1 }),
    makePhoto({ id: 'ph_2', url: 'https://cdn.example/2.jpg', order: 2 }),
    makePhoto({ id: 'ph_3', url: 'https://cdn.example/3.jpg', order: 3 }),
];

describe('RecipePhotoManager (web) — chrome + empty', () => {
    it('always renders the heading', () => {
        renderManager();
        expect(screen.getByRole('heading', { name: 'Photos' })).toBeTruthy();
    });

    it('shows the empty message when there are no photos', () => {
        renderManager({ photos: [] });
        expect(screen.getByText('No photos yet.')).toBeTruthy();
    });
});

describe('RecipePhotoManager (web) — populated', () => {
    it('renders one image + remove button per photo, with indexed accessible names', () => {
        renderManager({ photos: threePhotos });

        const list = screen.getByRole('list');
        expect(within(list).getAllByRole('listitem')).toHaveLength(3);
        expect(screen.getByRole('img', { name: 'Recipe photo 1' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove photo 3' })).toBeTruthy();
    });

    it('lays the photo grid out two-up at base and three-up from sm (U5 — 360px fit)', () => {
        renderManager({ photos: threePhotos });

        // Three 1/3-width cells are too narrow to tap at 360px, so the grid is two-up at base and restores the
        // original three-up at `sm:` — tablet/desktop unchanged.
        const list = screen.getByRole('list');
        expect(list.className).toContain('grid-cols-2');
        expect(list.className).toContain('sm:grid-cols-3');
    });

    it('renders confirmed-photo images lazy-loaded with an explicit dimension ratio (B7)', () => {
        renderManager({ photos: threePhotos });

        const img = screen.getByRole<HTMLImageElement>('img', { name: 'Recipe photo 1' });
        expect(img.getAttribute('loading')).toBe('lazy');
        expect(img.getAttribute('decoding')).toBe('async');
        expect(img.className).toContain('aspect-square');
    });

    it('reports the photo id to remove upward', async () => {
        const user = userEvent.setup();
        const onRemovePhoto = vi.fn();
        renderManager({ photos: threePhotos, onRemovePhoto });

        await user.click(screen.getByRole('button', { name: 'Remove photo 2' }));

        expect(onRemovePhoto).toHaveBeenCalledWith('ph_2');
    });

    it('busies and disables only the photo whose removal is in flight', () => {
        renderManager({ photos: threePhotos, removingPhotoId: 'ph_2' });

        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Remove photo 2' }).disabled).toBe(true);
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Remove photo 1' }).disabled).toBe(false);
    });
});

describe('RecipePhotoManager (web) — upload + error states', () => {
    it('shows a busy status while an upload is in flight, with its label as VISIBLE text', () => {
        renderManager({ uploading: true });

        // The live region must carry its label as CONTENT, not only as `aria-label`: an empty `role="status"`
        // paragraph is a zero-height node — invisible to a sighted viewer and silent to a screen reader (a
        // live region announces content CHANGES, and there is no content to change). Same doctrine as the
        // mobile `LoadingState`: the label doubles as the visible caption.
        const status = screen.getByRole('status', { name: 'Uploading photo' });
        expect(status.textContent).toBe('Uploading photo');
    });

    it('renders no busy status when nothing is uploading', () => {
        renderManager({ uploading: false });
        expect(screen.queryByRole('status', { name: 'Uploading photo' })).toBeNull();
    });

    it('shows an alert when an error message is present', () => {
        renderManager({ errorMessage: 'That file is too large.' });
        expect(screen.getByRole('alert').textContent).toContain('That file is too large.');
    });
});

describe('RecipePhotoManager (web) — add control + cap', () => {
    it('renders the add control below the cap', () => {
        renderManager({ photos: threePhotos, addControl: <button type="button">Add photo</button> });
        expect(screen.getByRole('button', { name: 'Add photo' })).toBeTruthy();
    });

    it('hides the add control and shows the cap notice at the photo limit', () => {
        const photos = Array.from({ length: MAX_RECIPE_PHOTOS }, (_unused, index) =>
            makePhoto({ id: `ph_${index}`, order: index + 1 }),
        );
        renderManager({ photos, addControl: <button type="button">Add photo</button> });

        expect(screen.queryByRole('button', { name: 'Add photo' })).toBeNull();
        expect(screen.getByText(`Maximum of ${MAX_RECIPE_PHOTOS} photos reached.`)).toBeTruthy();
    });

    // C6: wireframe recipe-edit.md:101-104 lists accepted formats/size inline near "+ Add Photo".
    it('renders the accepted-formats hint (derived from the shared 5 MB constant) next to the add control', () => {
        renderManager({ addControl: <button type="button">Add photo</button> });

        expect(screen.getByText('JPEG, PNG, or WebP · max 5 MB')).toBeTruthy();
    });

    it('hides the accepted-formats hint at the photo cap, alongside the add control', () => {
        const photos = Array.from({ length: MAX_RECIPE_PHOTOS }, (_unused, index) =>
            makePhoto({ id: `ph_${index}`, order: index + 1 }),
        );
        renderManager({ photos, addControl: <button type="button">Add photo</button> });

        expect(screen.queryByText('JPEG, PNG, or WebP · max 5 MB')).toBeNull();
    });
});

describe('RecipePhotoManager (web) — per-photo cover selection (U6)', () => {
    it('renders no cover badge and no cover radios when onSetCover is not wired (feature gated)', () => {
        renderManager({ photos: threePhotos });

        expect(screen.queryByText('Cover')).toBeNull();
        expect(screen.queryAllByRole('radio')).toHaveLength(0);
    });

    it('shows the "Cover" badge on the FIRST photo only (cover defaults to index 0)', () => {
        renderManager({ photos: threePhotos, onSetCover: noop });

        const badges = screen.getAllByText('Cover');
        expect(badges).toHaveLength(1);
        // The badge lives inside the first photo's list item — not the second or third.
        const firstItem = within(screen.getByRole('list')).getAllByRole('listitem')[0];
        expect(within(firstItem!).getByText('Cover')).toBeTruthy();
    });

    it('renders one radio-semantic "Set as cover" control per photo, indexed, with only the first checked', () => {
        renderManager({ photos: threePhotos, onSetCover: noop });

        expect(screen.getAllByRole('radio')).toHaveLength(3);
        expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Set photo 1 as cover' }).checked).toBe(true);
        expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Set photo 2 as cover' }).checked).toBe(false);
        expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Set photo 3 as cover' }).checked).toBe(false);
    });

    it('reports the chosen photo id upward when a non-cover "Set as cover" control is selected', async () => {
        const user = userEvent.setup();
        const onSetCover = vi.fn();
        renderManager({ photos: threePhotos, onSetCover });

        await user.click(screen.getByRole('radio', { name: 'Set photo 3 as cover' }));

        expect(onSetCover).toHaveBeenCalledWith('ph_3');
    });

    it('moves the "Cover" badge and the checked radio to the next photo once the former cover is removed', () => {
        const { rerender } = render(<RecipePhotoManager photos={threePhotos} onRemovePhoto={noop} onSetCover={noop} />);

        expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Set photo 1 as cover' }).checked).toBe(true);

        // The former cover `ph_1` is removed → the projection re-sorts and `ph_2` becomes index 0 (the new cover).
        rerender(<RecipePhotoManager photos={threePhotos.slice(1)} onRemovePhoto={noop} onSetCover={noop} />);

        expect(screen.getAllByText('Cover')).toHaveLength(1);
        expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Set photo 1 as cover' }).checked).toBe(true);
        // `ph_2` is now the sole remaining "photo 1"; the label is positional (index), so the check followed the cover.
    });
});

describe('RecipePhotoManager (web) — per-photo replace (U6)', () => {
    it('renders no Replace control when onReplacePhoto is not wired (feature gated)', () => {
        renderManager({ photos: threePhotos });

        expect(screen.queryByRole('button', { name: /replace/i })).toBeNull();
    });

    it('renders one indexed Replace control per photo when onReplacePhoto is wired', () => {
        renderManager({ photos: threePhotos, onReplacePhoto: noop });

        expect(screen.getByRole('button', { name: 'Replace photo 1' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Replace photo 3' })).toBeTruthy();
    });

    it('reports the photo id to replace upward when Replace is clicked', async () => {
        const user = userEvent.setup();
        const onReplacePhoto = vi.fn();
        renderManager({ photos: threePhotos, onReplacePhoto });

        await user.click(screen.getByRole('button', { name: 'Replace photo 2' }));

        expect(onReplacePhoto).toHaveBeenCalledWith('ph_2');
    });
});

describe('RecipePhotoManager (web) — per-file queue grid (w3/e4)', () => {
    it('renders the confirmed photos in a fixed 3-column grid', () => {
        renderManager({ photos: threePhotos });

        expect(screen.getByRole('list').className).toContain('grid-cols-3');
    });

    it('renders a queue-preview image lazy-loaded (B7)', () => {
        renderManager({
            queueItems: [
                makeQueueItem({ fileId: 1, fileName: 'a.png', status: 'uploading', previewUri: 'blob:a.png' }),
            ],
        });

        const img = screen.getByRole<HTMLImageElement>('img', { name: 'Photo a.png' });
        expect(img.getAttribute('loading')).toBe('lazy');
        expect(img.getAttribute('decoding')).toBe('async');
    });

    it('renders a status badge for a queued file', () => {
        renderManager({ queueItems: [makeQueueItem({ fileId: 1, fileName: 'a.png', status: 'queued' })] });

        expect(screen.getByRole('status', { name: 'Queued' })).toBeTruthy();
    });

    it('renders a status badge for an uploading file, with no retry/remove controls', () => {
        renderManager({ queueItems: [makeQueueItem({ fileId: 1, fileName: 'a.png', status: 'uploading' })] });

        expect(screen.getByRole('status', { name: 'Uploading…' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    });

    it('renders a FAILED file with a Retry and a Remove control, and no other status text confusable with it', () => {
        renderManager({
            queueItems: [makeQueueItem({ fileId: 7, fileName: 'burnt.png', status: 'failed', errorMessage: 'oops' })],
        });

        expect(screen.getByRole('alert', { name: 'Upload failed' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Retry upload of burnt.png' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove burnt.png' })).toBeTruthy();
    });

    it('renders the failed item’s own errorMessage as a distinct line naming WHY it failed (REQ-014)', () => {
        renderManager({
            queueItems: [
                makeQueueItem({
                    fileId: 7,
                    fileName: 'burnt.png',
                    status: 'failed',
                    errorMessage: 'That photo is larger than 5 MB.',
                }),
            ],
        });

        // Generic badge names WHICH photo failed (via its Retry/Remove labels); this text names WHY.
        expect(screen.getByRole('alert', { name: 'Upload failed' })).toBeTruthy();
        expect(screen.getByText('That photo is larger than 5 MB.')).toBeTruthy();
    });

    it('renders no error line for a failed item with no errorMessage', () => {
        renderManager({ queueItems: [makeQueueItem({ fileId: 7, fileName: 'burnt.png', status: 'failed' })] });

        expect(screen.getByRole('alert', { name: 'Upload failed' })).toBeTruthy();
        expect(document.querySelector('p.text-error')).toBeNull();
    });

    it('invokes onRetryQueueItem with the fileId when Retry is clicked', async () => {
        const user = userEvent.setup();
        const onRetryQueueItem = vi.fn();
        renderManager({
            queueItems: [makeQueueItem({ fileId: 7, fileName: 'burnt.png', status: 'failed' })],
            onRetryQueueItem,
        });

        await user.click(screen.getByRole('button', { name: 'Retry upload of burnt.png' }));

        expect(onRetryQueueItem).toHaveBeenCalledWith(7);
    });

    it('invokes onRemoveQueueItem with the fileId when Remove is clicked on a failed item', async () => {
        const user = userEvent.setup();
        const onRemoveQueueItem = vi.fn();
        renderManager({
            queueItems: [makeQueueItem({ fileId: 7, fileName: 'burnt.png', status: 'failed' })],
            onRemoveQueueItem,
        });

        await user.click(screen.getByRole('button', { name: 'Remove burnt.png' }));

        expect(onRemoveQueueItem).toHaveBeenCalledWith(7);
    });

    it('omits an `ok` queue item from the grid — it is folded into the confirmed photos', () => {
        renderManager({
            photos: [makePhoto({ id: 'ph_1' })],
            queueItems: [makeQueueItem({ fileId: 1, fileName: 'a.png', status: 'ok' })],
        });

        // Exactly one grid cell (the confirmed photo) — the `ok` queue item renders nothing extra.
        expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(1);
    });

    it('counts pending queue items toward the photo cap', () => {
        const photos = Array.from({ length: MAX_RECIPE_PHOTOS - 1 }, (_unused, index) =>
            makePhoto({ id: `ph_${index}`, order: index + 1 }),
        );
        renderManager({
            photos,
            queueItems: [makeQueueItem({ fileId: 1, fileName: 'a.png', status: 'uploading' })],
            addControl: <button type="button">Add photo</button>,
        });

        expect(screen.queryByRole('button', { name: 'Add photo' })).toBeNull();
        expect(screen.getByText(`Maximum of ${MAX_RECIPE_PHOTOS} photos reached.`)).toBeTruthy();
    });
});
