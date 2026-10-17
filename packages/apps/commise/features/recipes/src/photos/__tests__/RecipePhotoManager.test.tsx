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
    // A wired manager, as every container renders one. The unwired case is rendered directly where it is the subject.
    const props: RecipePhotoManagerProps = {
        photos: [],
        onRemovePhoto: noop,
        onRemoveQueueItem: noop,
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

    /**
     * A-010 (buildSpec §7.7): the section name is an H3 in the `label` role, muted — the same group heading the
     * Details section draws — not a display-face heading of its own. The old test pinned no style at all.
     */
    it('draws the heading as an H3 in the label role, muted (not the display face)', () => {
        renderManager();

        const heading = screen.getByRole('heading', { name: 'Photos', level: 3 });
        expect(heading.className).toContain('text-label');
        expect(heading.className).toContain('text-ink-muted');
        expect(heading.className).not.toContain('font-display');
        expect(heading.className).not.toContain('text-heading');
    });
});

/**
 * A-010 (buildSpec §7.7): with no photo the section previews the recipe's own cover and says what happens, in place of
 * the old bare "No photos yet." — which told the cook nothing about what the recipe looks like without one.
 * Replaces the old 'shows the empty message' case.
 */
describe('RecipePhotoManager (web) — empty state (A-010)', () => {
    const coverPreview = { recipeId: 'rec_1', title: 'Lemon tart' } as const;

    it('says the cover is used instead and that a photo can be added any time', () => {
        renderManager({ photos: [], coverPreview });

        expect(screen.getByText('No photo? This cover is used instead. Add one any time.')).toBeTruthy();
        expect(screen.queryByText('No photos yet.')).toBeNull();
    });

    it('previews the recipe’s own cover — its monogram, tinted by its id', () => {
        const { container } = render(
            <RecipePhotoManager
                photos={[]}
                onRemovePhoto={noop}
                coverPreview={{ recipeId: 'rec_1', title: 'Lemon tart' }}
            />,
        );

        expect(screen.getByText('L')).toBeTruthy();
        expect(container.querySelector('[class*="bg-cover-"]')).not.toBeNull();
    });

    it('shows the copy alone when no preview is supplied', () => {
        renderManager({ photos: [] });

        expect(screen.getByText('No photo? This cover is used instead. Add one any time.')).toBeTruthy();
        expect(document.querySelector('[class*="bg-cover-"]')).toBeNull();
    });

    it('shows no empty state once there is a photo', () => {
        renderManager({ photos: threePhotos, coverPreview });

        expect(screen.queryByText('No photo? This cover is used instead. Add one any time.')).toBeNull();
        expect(screen.queryByText('L')).toBeNull();
    });

    it('shows no empty state while a pick is waiting in the queue — that cell is the photo', () => {
        renderManager({ photos: [], coverPreview, queueItems: [makeQueueItem({ fileId: 1, status: 'queued' })] });

        expect(screen.queryByText('No photo? This cover is used instead. Add one any time.')).toBeNull();
        expect(screen.queryByText('L')).toBeNull();
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

    /**
     * buildSpec §7.7 rules 3 columns, 4 from 600 — and from 600 of the CONTAINER, not the viewport, because the editor
     * sits beside a rail from 840 px so the viewport says nothing about the width the grid has. jsdom evaluates no
     * container query, so this pins the classes; `recipePhotos.spec.ts` measures the real columns.
     *
     * ⚠️ DEPARTURE FROM §7.7, recorded: below 480 px of container the web grid stays two-up. §7.7's per-tile ⋯ menu is
     * what lets a 3-up tile at 320 hold one control; until it replaces the inline Cover, Remove and Replace controls, a
     * tile under about 130 px cannot hold the Cover badge and the Remove pill without them overlapping.
     */
    it('lays the photo grid out two-up, three-up from 480 px and four-up from 600 px of its own container', () => {
        renderManager({ photos: threePhotos });

        const list = screen.getByRole('list');
        expect(list.className.split(/\s+/u)).toEqual(
            expect.arrayContaining(['grid-cols-2', '@min-[480px]:grid-cols-3', '@min-[600px]:grid-cols-4']),
        );
        expect(list.parentElement?.className).toContain('@container');
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

    /**
     * REWRITTEN from native `disabled`: the control the cook just pressed goes busy, and a real browser drops focus
     * to <body> the moment a focused control is natively disabled (WCAG 2.2 SC 2.4.3). It stays focusable and
     * `aria-disabled` (`busyControlProps`), and the press is refused.
     */
    it('busies only the photo whose removal is in flight, keeping it focusable and refusing a second press', async () => {
        const user = userEvent.setup();
        const onRemovePhoto = vi.fn();
        renderManager({ photos: threePhotos, removingPhotoId: 'ph_2', onRemovePhoto });

        const removing = screen.getByRole<HTMLButtonElement>('button', { name: 'Remove photo 2' });
        expect(removing.disabled).toBe(false);
        expect(removing.getAttribute('aria-disabled')).toBe('true');
        expect(
            screen.getByRole<HTMLButtonElement>('button', { name: 'Remove photo 1' }).hasAttribute('aria-disabled'),
        ).toBe(false);

        await user.click(removing);
        expect(onRemovePhoto).not.toHaveBeenCalled();
    });
});

describe('RecipePhotoManager (web) — upload + error states', () => {
    it('shows a busy status while an upload is in flight, with its label as VISIBLE text', () => {
        renderManager({ uploading: true });

        // REWRITTEN for WCAG 4.1.3: the status is now a `LiveRegion` (mounted before the upload starts), whose
        // accessible name is not its content, so the assertion reads the TEXT. The label stays the visible caption
        // (`LoadingNotice` doctrine, specSharedSystem.md §18). Start, finish and failure are pinned in
        // `photoUploadAnnouncement.test.tsx`.
        expect(screen.getByText('Uploading photo').getAttribute('role')).toBe('status');
    });

    it('renders no busy text when nothing is uploading', () => {
        renderManager({ uploading: false });
        expect(screen.queryByText('Uploading photo')).toBeNull();
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
        const items = within(screen.getByRole('list')).getAllByRole('listitem');
        expect(within(items[1]!).queryByText('Cover')).toBeNull();
        expect(within(items[2]!).queryByText('Cover')).toBeNull();
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
    it('renders the queue cells in the same grid as the confirmed photos', () => {
        renderManager({
            photos: threePhotos,
            queueItems: [makeQueueItem({ fileId: 1, status: 'queued' })],
        });

        expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(4);
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

    it('offers no Remove on a queue cell when no remove handler is wired', () => {
        // A container withholds removal (the create's in-flight save) by not wiring it. A Remove that rendered anyway
        // would appear to work and do nothing.
        render(
            <RecipePhotoManager
                photos={[]}
                onRemovePhoto={noop}
                queueItems={[makeQueueItem({ fileId: 1, fileName: 'a.png', status: 'queued' })]}
            />,
        );

        expect(screen.getByRole('status', { name: 'Queued' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Remove a.png' })).toBeNull();
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

    it('renders a RETRYABLE failed file with a Retry and a Remove control, and no other status text confusable with it', () => {
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

    // The queue re-validates on retry BY DESIGN, so re-attempting a file the CLIENT rejected (too large /
    // wrong type) re-runs the same pure check against the same file and re-fails — Retry there is a dead
    // affordance that only invites a pointless click. Remove is the one meaningful action, and it must stay.
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
        // The reason still shows — the viewer is told WHY, they are just not offered a doomed retry.
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

        // Generic badge names WHICH photo failed (via its Retry/Remove labels); this text names WHY.
        expect(screen.getByRole('alert', { name: 'Upload failed' })).toBeTruthy();
        expect(screen.getByText('That photo is larger than 5 MB.')).toBeTruthy();
    });

    /**
     * E6 (A-010): the message used to be drawn ON the preview image, so its contrast depended on the photo. It sits
     * below the tile now, on the page background, in `dangerText`. The frame (the box holding the image, the status
     * badge and the buttons) must not contain it, and it must not be absolutely placed back over the image.
     */
    it('draws a failed item’s message BELOW the tile, not over the image (E6)', () => {
        renderManager({
            queueItems: [
                makeQueueItem({
                    fileId: 7,
                    fileName: 'burnt.png',
                    status: 'failed',
                    previewUri: 'blob:burnt.png',
                    errorMessage: 'That photo is larger than 5 MB.',
                }),
            ],
        });

        const image = screen.getByRole('img', { name: 'Photo burnt.png' });
        const frame = image.parentElement as HTMLElement;
        const message = screen.getByText('That photo is larger than 5 MB.');

        expect(frame.contains(message)).toBe(false);
        expect(within(screen.getByRole('listitem')).getByText('That photo is larger than 5 MB.')).toBe(message);
        expect(message.className).not.toContain('absolute');
        expect(message.className).toContain('text-danger-text');
        // The frame keeps the Retry/Remove controls and the status badge; only the prose left it.
        expect(within(frame).getByRole('alert', { name: 'Upload failed' })).toBeTruthy();
    });

    it('renders no error line for a failed item with no errorMessage', () => {
        renderManager({
            queueItems: [makeQueueItem({ fileId: 7, fileName: 'burnt.png', status: 'failed', retryable: true })],
        });

        expect(screen.getByRole('alert', { name: 'Upload failed' })).toBeTruthy();
        expect(document.querySelector('p.text-error-dark')).toBeNull();
    });

    it('invokes onRetryQueueItem with the fileId when Retry is clicked', async () => {
        const user = userEvent.setup();
        const onRetryQueueItem = vi.fn();
        renderManager({
            queueItems: [makeQueueItem({ fileId: 7, fileName: 'burnt.png', status: 'failed', retryable: true })],
            onRetryQueueItem,
        });

        await user.click(screen.getByRole('button', { name: 'Retry upload of burnt.png' }));

        expect(onRetryQueueItem).toHaveBeenCalledWith(7);
    });

    it('invokes onRemoveQueueItem with the fileId when Remove is clicked on a failed item', async () => {
        const user = userEvent.setup();
        const onRemoveQueueItem = vi.fn();
        renderManager({
            queueItems: [makeQueueItem({ fileId: 7, fileName: 'burnt.png', status: 'failed', retryable: true })],
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
