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
    /**
     * buildSpec §7.7 rules 3 columns, 4 from 600 — and from 600 of the CONTAINER, not the viewport, because the editor
     * sits beside a rail from 840 px so the viewport says nothing about the width the grid has. jsdom evaluates no
     * container query, so this pins the classes; `recipePhotos.spec.ts` measures the real columns.
     *
     * ⚠️ DEPARTURE FROM §7.7, recorded: below 480 px of container the web grid stays two-up. The per-tile ⋯ menu
     * (2026-10-17) is one 44 px disc where there were three controls, but a 3-up tile at 320 is about 90 px and holds
     * a 44 px disc beside the "Upload failed" badge only if the two are laid out apart; that layout is a visual check
     * owed (`recipePhotos.spec.ts` measures the columns), so the grid stays two-up until it is made.
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

/** The tile's ⋯ menu, opened: returns the user and the menu. */
async function openMenu(triggerName: string) {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: triggerName }));

    return { user, menu: screen.getByRole('menu') };
}

const allWired = (overrides: Partial<RecipePhotoManagerProps> = {}): Partial<RecipePhotoManagerProps> => ({
    photos: threePhotos,
    onSetCover: noop,
    onMovePhoto: noop,
    onReplacePhoto: noop,
    ...overrides,
});

const MENU_ITEMS = ['Set as cover', 'Move earlier', 'Move later', 'Replace', 'Remove'] as const;

const itemState = (name: string): 'disabled' | 'enabled' =>
    screen.getByRole('menuitem', { name }).getAttribute('aria-disabled') === 'true' ? 'disabled' : 'enabled';

/**
 * Owner ruling 2026-10-17 (buildSpec §7.7 + Replace): each photo tile carries ONE ⋯ menu button, 44 px, holding
 * Set as cover, Move earlier, Move later, Replace and, after a divider, Remove. It replaces the inline Remove pill, the
 * cover radio and the Replace pill (parity audit G4, F1-F3: ~24 px controls).
 */
describe('RecipePhotoManager (web) — the tile’s ⋯ menu (2026-10-17)', () => {
    it('gives every photo one menu button named for its position, and no inline Remove, Replace or cover radio', () => {
        renderManager(allWired());

        for (const index of [1, 2, 3]) {
            const trigger = screen.getByRole('button', {
                name: index === 1 ? 'Actions for photo 1, the cover' : `Actions for photo ${index}`,
            });
            expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
        }

        expect(screen.queryByRole('button', { name: /^(remove|replace) photo/i })).toBeNull();
        expect(screen.queryAllByRole('radio')).toHaveLength(0);
    });

    it('makes the menu button a 44 px target (SC 2.5.8)', () => {
        renderManager(allWired());

        expect(screen.getByRole('button', { name: 'Actions for photo 2' }).className).toContain('size-11');
    });

    it('lists Set as cover, Move earlier, Move later, Replace, then Remove after a divider', async () => {
        renderManager(allWired());

        const { menu } = await openMenu('Actions for photo 2');

        expect(
            within(menu)
                .getAllByRole('menuitem')
                .map((item) => item.textContent),
        ).toEqual([...MENU_ITEMS]);
        expect(within(menu).getByRole('separator')).toBeTruthy();
    });

    it('enables everything on a middle photo', async () => {
        renderManager(allWired());
        await openMenu('Actions for photo 2');

        expect(MENU_ITEMS.map(itemState)).toEqual(['enabled', 'enabled', 'enabled', 'enabled', 'enabled']);
    });

    it('on the cover: Set as cover and Move earlier are disabled, and the trigger’s name says it is the cover (SC 4.1.2)', async () => {
        renderManager(allWired());
        await openMenu('Actions for photo 1, the cover');

        expect(itemState('Set as cover')).toBe('disabled');
        expect(itemState('Move earlier')).toBe('disabled');
        expect(itemState('Move later')).toBe('enabled');
    });

    it('on the last photo: Move later is disabled', async () => {
        renderManager(allWired());
        await openMenu('Actions for photo 3');

        expect(itemState('Move later')).toBe('disabled');
        expect(itemState('Move earlier')).toBe('enabled');
        expect(itemState('Set as cover')).toBe('enabled');
    });

    it('on a single photo: nothing can move and it is already the cover, but Replace and Remove work', async () => {
        renderManager(allWired({ photos: [threePhotos[0]!] }));
        await openMenu('Actions for photo 1, the cover');

        expect(MENU_ITEMS.map(itemState)).toEqual(['disabled', 'disabled', 'disabled', 'enabled', 'enabled']);
    });

    it('reports each choice upward with the photo id', async () => {
        const onSetCover = vi.fn();
        const onMovePhoto = vi.fn();
        const onReplacePhoto = vi.fn();
        const onRemovePhoto = vi.fn();
        renderManager(allWired({ onSetCover, onMovePhoto, onReplacePhoto, onRemovePhoto }));

        for (const name of MENU_ITEMS) {
            const { user } = await openMenu('Actions for photo 2');
            await user.click(screen.getByRole('menuitem', { name }));
        }

        expect(onSetCover).toHaveBeenCalledExactlyOnceWith('ph_2');
        expect(onMovePhoto.mock.calls).toEqual([
            ['ph_2', 'earlier'],
            ['ph_2', 'later'],
        ]);
        expect(onReplacePhoto).toHaveBeenCalledExactlyOnceWith('ph_2');
        expect(onRemovePhoto).toHaveBeenCalledExactlyOnceWith('ph_2');
    });

    it('runs nothing for a disabled item', async () => {
        const onMovePhoto = vi.fn();
        renderManager(allWired({ onMovePhoto }));
        const { user } = await openMenu('Actions for photo 1, the cover');

        await user.click(screen.getByRole('menuitem', { name: 'Move earlier' }));

        expect(onMovePhoto).not.toHaveBeenCalled();
    });

    it('offers only what the container wired: no cover badge, no Set as cover, no moves, no Replace', async () => {
        renderManager({ photos: threePhotos });
        await openMenu('Actions for photo 2');

        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Remove']);
        expect(screen.queryByText('Cover')).toBeNull();
    });

    it('shows the "Cover" badge on the FIRST photo only, as text', () => {
        renderManager(allWired());

        const items = within(screen.getByRole('list')).getAllByRole('listitem');
        expect(screen.getAllByText('Cover')).toHaveLength(1);
        expect(within(items[0]!).getByText('Cover')).toBeTruthy();
    });

    it('moves the badge and the cover reading to the next photo once the former cover is removed', () => {
        const { rerender } = render(<RecipePhotoManager photos={threePhotos} onRemovePhoto={noop} onSetCover={noop} />);
        expect(screen.getByRole('button', { name: 'Actions for photo 1, the cover' })).toBeTruthy();

        rerender(<RecipePhotoManager photos={threePhotos.slice(1)} onRemovePhoto={noop} onSetCover={noop} />);

        expect(screen.getAllByText('Cover')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Actions for photo 1, the cover' })).toBeTruthy();
    });

    it('keeps Replace and Remove but disables Set as cover and both moves while a reorder is in flight', async () => {
        renderManager(allWired({ reordering: true }));
        await openMenu('Actions for photo 2');

        expect(MENU_ITEMS.map(itemState)).toEqual(['disabled', 'disabled', 'disabled', 'enabled', 'enabled']);
    });

    /**
     * REWRITTEN from the Remove pill: the tile whose removal is in flight cannot open its menu (the trigger is
     * `aria-disabled` and stays focusable, SC 2.4.3) and says "Removing…" as text; its siblings are untouched.
     */
    it('busies only the photo whose removal is in flight: its menu will not open and it says so', async () => {
        const user = userEvent.setup();
        renderManager(allWired({ removingPhotoId: 'ph_2' }));

        const removing = screen.getByRole<HTMLButtonElement>('button', { name: 'Actions for photo 2' });
        expect(removing.disabled).toBe(false);
        expect(removing.getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByText('Removing…')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Actions for photo 3' }).hasAttribute('aria-disabled')).toBe(false);

        await user.click(removing);
        expect(screen.queryByRole('menu')).toBeNull();
    });
});

describe('RecipePhotoManager (web) — a queue tile’s actions (2026-10-17)', () => {
    const retryable = makeQueueItem({ fileId: 7, fileName: 'burnt.png', status: 'failed', retryable: true });

    it('gives an uploading file no controls at all — its status is the whole tile', () => {
        renderManager({ queueItems: [makeQueueItem({ fileId: 1, fileName: 'a.png', status: 'uploading' })] });

        expect(screen.queryByRole('button')).toBeNull();
    });

    it('gives a queued file a ⋯ menu holding Remove', async () => {
        const onRemoveQueueItem = vi.fn();
        renderManager({
            queueItems: [makeQueueItem({ fileId: 4, fileName: 'a.png', status: 'queued' })],
            onRemoveQueueItem,
        });

        const { user } = await openMenu('Actions for a.png');
        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Remove']);
        await user.click(screen.getByRole('menuitem', { name: 'Remove' }));

        expect(onRemoveQueueItem).toHaveBeenCalledWith(4);
    });

    it('offers no menu when no remove handler is wired — a container withholds removal by not wiring it', () => {
        render(
            <RecipePhotoManager
                photos={[]}
                onRemovePhoto={noop}
                queueItems={[makeQueueItem({ fileId: 1, fileName: 'a.png', status: 'queued' })]}
            />,
        );

        expect(screen.getByRole('status', { name: 'Queued' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Actions for a.png' })).toBeNull();
    });

    /**
     * DECISION: Retry stays a VISIBLE button on the failed tile, not a menu item. Retry is the one recovery for the
     * tile's headline state, so it is one tap, at the design system's `Button` size (min 44 px); Remove, the rarer and
     * destructive half, moves into the ⋯ menu with the other tiles' actions.
     */
    it('keeps Retry a visible, full-size button on a retryable failed file, with Remove in its menu', async () => {
        const onRetryQueueItem = vi.fn();
        const onRemoveQueueItem = vi.fn();
        renderManager({ queueItems: [retryable], onRetryQueueItem, onRemoveQueueItem });

        const retry = screen.getByRole('button', { name: 'Retry upload of burnt.png' });
        expect(retry.className).toContain('min-h-11');
        expect(screen.getByRole('alert', { name: 'Upload failed' })).toBeTruthy();

        const user = userEvent.setup();
        await user.click(retry);
        expect(onRetryQueueItem).toHaveBeenCalledWith(7);

        await openMenu('Actions for burnt.png');
        await user.click(screen.getByRole('menuitem', { name: 'Remove' }));
        expect(onRemoveQueueItem).toHaveBeenCalledWith(7);
    });

    // The queue re-validates on retry BY DESIGN, so re-attempting a file the CLIENT rejected re-fails identically:
    // Retry there is a dead affordance. The tile keeps WHY it failed and the one meaningful action, Remove.
    it('offers Remove but NOT Retry for a client-validation rejection (`retryable: false`)', async () => {
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
        await openMenu('Actions for huge.png');
        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Remove']);
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

    it('renders a status badge for a queued file', () => {
        renderManager({ queueItems: [makeQueueItem({ fileId: 1, fileName: 'a.png', status: 'queued' })] });

        expect(screen.getByRole('status', { name: 'Queued' })).toBeTruthy();
    });

    it('renders a status badge for an uploading file, with no retry/remove controls', () => {
        renderManager({ queueItems: [makeQueueItem({ fileId: 1, fileName: 'a.png', status: 'uploading' })] });

        expect(screen.getByRole('status', { name: 'Uploading…' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
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
