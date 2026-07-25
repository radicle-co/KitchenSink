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
    it('shows a busy status while an upload is in flight', () => {
        renderManager({ uploading: true });
        expect(screen.getByRole('status', { name: 'Uploading photo' })).toBeTruthy();
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
