/**
 * Native component tests for the recipe photo manager (T067), rendered via react-native-web under jsdom.
 * Mirrors the web leaf across every state — empty, populated, per-photo removing-busy, upload status, error,
 * and the add-control/cap boundary — so the two platform renders cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { Pressable, Text } from 'react-native';

import { makePhoto, makeQueueItem } from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipePhotoManager } from '../RecipePhotoManager.native.js';
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

describe('RecipePhotoManager (native) — chrome + empty', () => {
    it('always renders the heading', () => {
        renderManager();
        expect(screen.getByRole('heading', { name: 'Photos' })).toBeTruthy();
    });

    it('shows the empty message when there are no photos', () => {
        renderManager({ photos: [] });
        expect(screen.getByText('No photos yet.')).toBeTruthy();
    });
});

describe('RecipePhotoManager (native) — populated', () => {
    it('renders one image + remove button per photo, with indexed accessible names', () => {
        renderManager({ photos: threePhotos });

        expect(screen.getAllByRole('img')).toHaveLength(3);
        expect(screen.getByRole('img', { name: 'Recipe photo 1' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove photo 3' })).toBeTruthy();
    });

    it('reports the photo id to remove upward', () => {
        const onRemovePhoto = vi.fn();
        renderManager({ photos: threePhotos, onRemovePhoto });

        fireEvent.click(screen.getByRole('button', { name: 'Remove photo 2' }));

        expect(onRemovePhoto).toHaveBeenCalledWith('ph_2');
    });

    it('busies and disables only the photo whose removal is in flight', () => {
        renderManager({ photos: threePhotos, removingPhotoId: 'ph_2' });

        expect(screen.getByRole('button', { name: 'Remove photo 2' }).getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByRole('button', { name: 'Remove photo 1' }).getAttribute('aria-disabled')).not.toBe('true');
    });
});

describe('RecipePhotoManager (native) — upload + error states', () => {
    it('shows a busy status while an upload is in flight', () => {
        renderManager({ uploading: true });
        expect(screen.getByRole('progressbar', { name: 'Uploading photo' })).toBeTruthy();
    });

    it('shows an alert when an error message is present', () => {
        renderManager({ errorMessage: 'That file is too large.' });
        expect(screen.getByRole('alert').textContent).toContain('That file is too large.');
    });
});

describe('RecipePhotoManager (native) — add control + cap', () => {
    it('renders the add control below the cap', () => {
        renderManager({
            photos: threePhotos,
            addControl: (
                <Pressable accessibilityRole="button" accessibilityLabel="Add photo">
                    <Text>Add photo</Text>
                </Pressable>
            ),
        });
        expect(screen.getByRole('button', { name: 'Add photo' })).toBeTruthy();
    });

    it('hides the add control and shows the cap notice at the photo limit', () => {
        const photos = Array.from({ length: MAX_RECIPE_PHOTOS }, (_unused, index) =>
            makePhoto({ id: `ph_${index}`, order: index + 1 }),
        );
        renderManager({
            photos,
            addControl: (
                <Pressable accessibilityRole="button" accessibilityLabel="Add photo">
                    <Text>Add photo</Text>
                </Pressable>
            ),
        });

        expect(screen.queryByRole('button', { name: 'Add photo' })).toBeNull();
        expect(screen.getByText(`Maximum of ${MAX_RECIPE_PHOTOS} photos reached.`)).toBeTruthy();
    });
});

describe('RecipePhotoManager (native) — per-file queue grid (w3/e4)', () => {
    it('renders a status badge for a queued file', () => {
        renderManager({ queueItems: [makeQueueItem({ fileId: 1, fileName: 'a.png', status: 'queued' })] });

        expect(screen.getByLabelText('Queued')).toBeTruthy();
    });

    it('renders a status badge for an uploading file, with no retry/remove controls', () => {
        renderManager({ queueItems: [makeQueueItem({ fileId: 1, fileName: 'a.png', status: 'uploading' })] });

        expect(screen.getByLabelText('Uploading…')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    });

    it('renders a FAILED file with a Retry and a Remove control', () => {
        renderManager({
            queueItems: [makeQueueItem({ fileId: 7, fileName: 'burnt.png', status: 'failed', errorMessage: 'oops' })],
        });

        expect(screen.getByRole('alert', { name: 'Upload failed' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Retry upload of burnt.png' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove burnt.png' })).toBeTruthy();
    });

    it('invokes onRetryQueueItem with the fileId when Retry is pressed', () => {
        const onRetryQueueItem = vi.fn();
        renderManager({
            queueItems: [makeQueueItem({ fileId: 7, fileName: 'burnt.png', status: 'failed' })],
            onRetryQueueItem,
        });

        fireEvent.click(screen.getByRole('button', { name: 'Retry upload of burnt.png' }));

        expect(onRetryQueueItem).toHaveBeenCalledWith(7);
    });

    it('invokes onRemoveQueueItem with the fileId when Remove is pressed on a failed item', () => {
        const onRemoveQueueItem = vi.fn();
        renderManager({
            queueItems: [makeQueueItem({ fileId: 7, fileName: 'burnt.png', status: 'failed' })],
            onRemoveQueueItem,
        });

        fireEvent.click(screen.getByRole('button', { name: 'Remove burnt.png' }));

        expect(onRemoveQueueItem).toHaveBeenCalledWith(7);
    });

    it('omits an `ok` queue item from the grid — it is folded into the confirmed photos', () => {
        renderManager({
            photos: [makePhoto({ id: 'ph_1' })],
            queueItems: [makeQueueItem({ fileId: 1, fileName: 'a.png', status: 'ok' })],
        });

        expect(screen.getAllByRole('img')).toHaveLength(1);
    });

    it('counts pending queue items toward the photo cap', () => {
        const photos = Array.from({ length: MAX_RECIPE_PHOTOS - 1 }, (_unused, index) =>
            makePhoto({ id: `ph_${index}`, order: index + 1 }),
        );
        renderManager({
            photos,
            queueItems: [makeQueueItem({ fileId: 1, fileName: 'a.png', status: 'uploading' })],
            addControl: (
                <Pressable accessibilityRole="button" accessibilityLabel="Add photo">
                    <Text>Add photo</Text>
                </Pressable>
            ),
        });

        expect(screen.queryByRole('button', { name: 'Add photo' })).toBeNull();
        expect(screen.getByText(`Maximum of ${MAX_RECIPE_PHOTOS} photos reached.`)).toBeTruthy();
    });
});
