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
    it('shows a busy status while an upload is in flight, with its label as VISIBLE text', () => {
        renderManager({ uploading: true });

        // A named-but-empty progressbar is a nameless spinning shape with nothing to look at: the label has to
        // double as the visible caption (the `components/LoadingState` doctrine), so a sighted viewer can tell
        // "uploading" from "wedged".
        expect(screen.getByRole('progressbar', { name: 'Uploading photo' })).toBeTruthy();
        expect(screen.getByText('Uploading photo')).toBeTruthy();
    });

    it('renders no busy status when nothing is uploading', () => {
        renderManager({ uploading: false });
        expect(screen.queryByRole('progressbar', { name: 'Uploading photo' })).toBeNull();
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

    // C6: wireframe recipe-edit.md:101-104 lists accepted formats/size inline near "+ Add Photo".
    it('renders the accepted-formats hint (derived from the shared 5 MB constant) next to the add control', () => {
        renderManager({
            addControl: (
                <Pressable accessibilityRole="button" accessibilityLabel="Add photo">
                    <Text>Add photo</Text>
                </Pressable>
            ),
        });

        expect(screen.getByText('JPEG, PNG, or WebP · max 5 MB')).toBeTruthy();
    });

    it('hides the accepted-formats hint at the photo cap, alongside the add control', () => {
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

        expect(screen.queryByText('JPEG, PNG, or WebP · max 5 MB')).toBeNull();
    });
});

describe('RecipePhotoManager (native) — per-photo cover selection (U6)', () => {
    it('renders no cover badge and no cover radios when onSetCover is not wired (feature gated)', () => {
        renderManager({ photos: threePhotos });

        expect(screen.queryByText('Cover')).toBeNull();
        expect(screen.queryAllByRole('radio')).toHaveLength(0);
    });

    it('shows the "Cover" badge on the FIRST photo only (cover defaults to index 0)', () => {
        renderManager({ photos: threePhotos, onSetCover: noop });

        expect(screen.getAllByText('Cover')).toHaveLength(1);
    });

    it('renders one radio-semantic "Set as cover" control per photo, indexed, with only the first checked', () => {
        renderManager({ photos: threePhotos, onSetCover: noop });

        expect(screen.getAllByRole('radio')).toHaveLength(3);
        expect(screen.getByRole('radio', { name: 'Set photo 1 as cover' }).getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('radio', { name: 'Set photo 2 as cover' }).getAttribute('aria-checked')).not.toBe(
            'true',
        );
    });

    it('reports the chosen photo id upward when a non-cover "Set as cover" control is pressed', () => {
        const onSetCover = vi.fn();
        renderManager({ photos: threePhotos, onSetCover });

        fireEvent.click(screen.getByRole('radio', { name: 'Set photo 3 as cover' }));

        expect(onSetCover).toHaveBeenCalledWith('ph_3');
    });
});

describe('RecipePhotoManager (native) — per-photo replace (U6)', () => {
    it('renders no Replace control when onReplacePhoto is not wired (feature gated)', () => {
        renderManager({ photos: threePhotos });

        expect(screen.queryByRole('button', { name: /replace/i })).toBeNull();
    });

    it('renders one indexed Replace control per photo, and reports the id upward when pressed', () => {
        const onReplacePhoto = vi.fn();
        renderManager({ photos: threePhotos, onReplacePhoto });

        expect(screen.getByRole('button', { name: 'Replace photo 1' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Replace photo 2' }));

        expect(onReplacePhoto).toHaveBeenCalledWith('ph_2');
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

    it('renders a RETRYABLE failed file with a Retry and a Remove control', () => {
        renderManager({
            queueItems: [
                makeQueueItem({
                    fileId: 7,
                    fileName: 'burnt.png',
                    status: 'failed',
                    retryable: true,
                    errorMessage: 'oops',
                }),
            ],
        });

        expect(screen.getByRole('alert', { name: 'Upload failed' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Retry upload of burnt.png' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove burnt.png' })).toBeTruthy();
    });

    // Same reasoning as the web leaf: retry re-validates, so a client-rejected file can never succeed on a
    // re-attempt. Remove is the only meaningful action.
    it('offers Remove but NOT Retry for a client-validation rejection (`retryable: false`)', () => {
        renderManager({
            queueItems: [
                makeQueueItem({
                    fileId: 7,
                    fileName: 'huge.png',
                    status: 'failed',
                    retryable: false,
                    errorMessage: 'That photo is larger than 5 MB.',
                }),
            ],
        });

        expect(screen.getByRole('alert', { name: 'Upload failed' })).toBeTruthy();
        expect(screen.getByText('That photo is larger than 5 MB.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Retry upload of huge.png' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Remove huge.png' })).toBeTruthy();
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

        expect(screen.getByRole('alert', { name: 'Upload failed' })).toBeTruthy();
        expect(screen.getByText('That photo is larger than 5 MB.')).toBeTruthy();
    });

    it('invokes onRetryQueueItem with the fileId when Retry is pressed', () => {
        const onRetryQueueItem = vi.fn();
        renderManager({
            queueItems: [makeQueueItem({ fileId: 7, fileName: 'burnt.png', status: 'failed', retryable: true })],
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
