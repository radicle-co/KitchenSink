/**
 * Native component tests for the recipe photo manager (T067), rendered via react-native-web under jsdom.
 * Mirrors the web leaf across every state — empty, populated, per-photo removing-busy, upload status, error,
 * and the add-control/cap boundary — so the two platform renders cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { Pressable, Text, type Modal as ModalType } from 'react-native';
import { createElement, type ComponentProps } from 'react';

import { role, roleDark } from '@commise/ui/colors';
import { nativeTokens } from '@commise/ui/native';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';

import { makePhoto, makeQueueItem } from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipePhotoManager } from '../RecipePhotoManager.native.js';
import { MAX_RECIPE_PHOTOS, type RecipePhotoManagerProps } from '../model.js';

// The platform the render stands in for, and the sheet's Modal: its `onDismiss` is held back so a test fires it itself,
// standing in for iOS, where React Native reports the end of the slide-out that way (`ActionMenu.native.test.tsx`).
const platform = vi.hoisted(() => ({ os: 'ios' as 'ios' | 'android' }));
const modal = vi.hoisted(() => ({
    props: undefined as ComponentProps<typeof ModalType> | undefined,
    dismiss: (): void => undefined,
}));

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');
    const actual = withSystemScheme(await importOriginal<typeof import('react-native')>());

    return {
        ...actual,
        Platform: {
            ...actual.Platform,
            get OS() {
                return platform.os;
            },
        },
        Modal: (props: ComponentProps<typeof ModalType>) => {
            modal.props = props;
            modal.dismiss = () => props.onDismiss?.();

            return createElement(actual.Modal, { ...props, onDismiss: undefined });
        },
    };
});
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

afterEach(() => {
    cleanup();
    systemScheme.current = null;
    platform.os = 'ios';
});

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

describe('RecipePhotoManager (native) — chrome + empty', () => {
    it('always renders the heading', () => {
        renderManager();
        expect(screen.getByRole('heading', { name: 'Photos' })).toBeTruthy();
    });
});

/**
 * A-010 (buildSpec §7.7): with no photo the section previews the recipe's own cover and says what happens, in place of
 * the old bare "No photos yet." Replaces the old 'shows the empty message' case; the web leaf pins the same cases.
 */
describe('RecipePhotoManager (native) — empty state (A-010)', () => {
    const coverPreview = { recipeId: 'rec_1', title: 'Lemon tart' } as const;

    it('says the cover is used instead and that a photo can be added any time', () => {
        renderManager({ photos: [], coverPreview });

        expect(screen.getByText('No photo? This cover is used instead. Add one any time.')).toBeTruthy();
        expect(screen.queryByText('No photos yet.')).toBeNull();
    });

    it('previews the recipe’s own cover — its monogram', () => {
        renderManager({ photos: [], coverPreview });

        expect(screen.getByText('L')).toBeTruthy();
    });

    it('shows the copy alone when no preview is supplied', () => {
        renderManager({ photos: [] });

        expect(screen.getByText('No photo? This cover is used instead. Add one any time.')).toBeTruthy();
        expect(screen.queryByText('L')).toBeNull();
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

/** Report a laid-out width to a view, the way react-native-web's ResizeObserver does (jsdom lays nothing out). */
function layOut(element: Element, width: number): void {
    const handler = (element as Element & { __reactLayoutHandler?: (event: unknown) => void }).__reactLayoutHandler;

    if (handler === undefined) {
        throw new Error('the view has no layout handler');
    }

    act(() => handler({ nativeEvent: { layout: { x: 0, y: 0, width, height: 400 } } }));
}

/** The grid view: the parent of the first cell. */
function gridOf(photoLabel: string): Element {
    const cell = screen.getByLabelText(photoLabel).parentElement;
    const grid = cell?.parentElement;

    if (grid === null || grid === undefined) {
        throw new Error('no grid');
    }

    return grid;
}

/**
 * A-010 (buildSpec §7.7): three columns, four from 600 of the grid's OWN width. The grid measures itself rather than
 * asking the window, because the window is not the container (a tablet editor sits beside a rail) and jsdom's window
 * is 1024 wide, which would hand every test four columns. Until the first measure it holds the narrow reading.
 */
describe('RecipePhotoManager (native) — the grid columns (A-010)', () => {
    it('is three-up until the grid has been measured', () => {
        renderManager({ photos: threePhotos });

        expect(getComputedStyle(screen.getByLabelText('Recipe photo 1').parentElement as Element).width).toBe('31%');
    });

    it('stays three-up at 599 and goes four-up at 600', () => {
        renderManager({ photos: threePhotos });
        const grid = gridOf('Recipe photo 1');
        const cell = screen.getByLabelText('Recipe photo 1').parentElement as Element;

        layOut(grid, 599);
        expect(getComputedStyle(cell).width).toBe('31%');

        layOut(grid, 600);
        expect(getComputedStyle(cell).width).toBe('23%');
    });

    it('lays a queue cell out at the same width as a confirmed one', () => {
        renderManager({
            photos: threePhotos,
            queueItems: [
                makeQueueItem({ fileId: 1, fileName: 'a.png', status: 'uploading', previewUri: 'file:///a.png' }),
            ],
        });
        layOut(gridOf('Recipe photo 1'), 700);

        const queued = screen.getByLabelText('Photo a.png').parentElement?.parentElement as Element;
        expect(getComputedStyle(queued).width).toBe('23%');
    });
});

/**
 * E6 (A-010): the message used to be a `position: absolute` text over the preview, so its contrast depended on the
 * photo. It sits below the tile now, in `dangerText`, in flow.
 */
describe('RecipePhotoManager (native) — a failed upload’s message (E6)', () => {
    it('draws the message BELOW the tile, in flow, not over the image', () => {
        renderManager({
            queueItems: [
                makeQueueItem({
                    fileId: 7,
                    fileName: 'burnt.png',
                    status: 'failed',
                    previewUri: 'file:///burnt.png',
                    errorMessage: 'That photo is larger than 5 MB.',
                }),
            ],
        });

        const image = screen.getByLabelText('Photo burnt.png');
        const frame = image.parentElement as HTMLElement;
        const message = screen.getByText('That photo is larger than 5 MB.');

        expect(frame.contains(message)).toBe(false);
        expect(getComputedStyle(message).position).not.toBe('absolute');
        expect(frame.parentElement?.contains(message)).toBe(true);
        expect(within(frame).getByText('Upload failed')).toBeTruthy();
    });
});

describe('RecipePhotoManager (native) — populated', () => {
    it('renders one image per photo, with indexed accessible names', () => {
        renderManager({ photos: threePhotos });

        expect(screen.getAllByRole('img')).toHaveLength(3);
        expect(screen.getByRole('img', { name: 'Recipe photo 1' })).toBeTruthy();
    });
});

describe('RecipePhotoManager (native) — upload + error states', () => {
    it('shows a busy status while an upload is in flight, with its label as VISIBLE text', () => {
        renderManager({ uploading: true });

        // REWRITTEN for WCAG 4.1.3: a bare `progressbar` had no live region, so nothing spoke between choosing a
        // photo and the result. The label is now the text of a polite `LiveRegion` and stays the visible caption
        // (`LoadingNotice` doctrine, specSharedSystem.md §18). Start, finish and failure are pinned in
        // `photoUploadAnnouncement.native.test.tsx`.
        expect(screen.getByText('Uploading photo').getAttribute('aria-live')).toBe('polite');
        expect(screen.queryByRole('progressbar')).toBeNull();
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

/** Open a tile's ⋯ menu (a sheet on native) by the button's name. */
function openMenu(triggerName: string) {
    fireEvent.click(screen.getByRole('button', { name: triggerName }));
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
 * Owner ruling 2026-10-17 (buildSpec §7.7 + Replace): each photo tile carries ONE ⋯ menu button, 44 pt on iOS and 48 dp
 * on Android, opening a sheet of Set as cover, Move earlier, Move later, Replace and, after a divider, Remove. It
 * replaces the Remove pill (~21 pt), the cover radio (24 pt) and the Replace pill (parity audit G4, F1-F2).
 */
describe('RecipePhotoManager (native) — the tile’s ⋯ menu (2026-10-17)', () => {
    it('gives every photo one menu button named for its position, and no inline Remove, Replace or cover radio', () => {
        renderManager(allWired());

        expect(screen.getByRole('button', { name: 'Actions for photo 1, the cover' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Actions for photo 2' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Actions for photo 3' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^(remove|replace) photo/i })).toBeNull();
        expect(screen.queryAllByRole('radio')).toHaveLength(0);
    });

    it.each([
        ['ios', 44],
        ['android', 48],
    ] as const)('makes the menu button a %s target of at least %i', (os, size) => {
        platform.os = os;
        renderManager(allWired());
        const trigger = getComputedStyle(screen.getByRole('button', { name: 'Actions for photo 2' }));

        expect(Number.parseFloat(trigger.width)).toBeGreaterThanOrEqual(size);
        expect(Number.parseFloat(trigger.height)).toBeGreaterThanOrEqual(size);
    });

    it('lists Set as cover, Move earlier, Move later, Replace, then Remove after a divider', () => {
        renderManager(allWired());
        openMenu('Actions for photo 2');

        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([...MENU_ITEMS]);
        expect(screen.getByRole('separator')).toBeTruthy();
    });

    it('titles the sheet for its photo', () => {
        renderManager(allWired());
        openMenu('Actions for photo 2');

        expect(screen.getByText('Photo 2')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Close actions for photo 2' })).toBeTruthy();
    });

    it('enables everything on a middle photo', () => {
        renderManager(allWired());
        openMenu('Actions for photo 2');

        expect(MENU_ITEMS.map(itemState)).toEqual(['enabled', 'enabled', 'enabled', 'enabled', 'enabled']);
    });

    it('on the cover: Set as cover and Move earlier are disabled, and the trigger’s name says it is the cover (SC 4.1.2)', () => {
        renderManager(allWired());
        openMenu('Actions for photo 1, the cover');

        expect(itemState('Set as cover')).toBe('disabled');
        expect(itemState('Move earlier')).toBe('disabled');
        expect(itemState('Move later')).toBe('enabled');
    });

    it('on the last photo: Move later is disabled', () => {
        renderManager(allWired());
        openMenu('Actions for photo 3');

        expect(itemState('Move later')).toBe('disabled');
        expect(itemState('Move earlier')).toBe('enabled');
        expect(itemState('Set as cover')).toBe('enabled');
    });

    it('on a single photo: nothing can move and it is already the cover, but Replace and Remove work', () => {
        renderManager(allWired({ photos: [threePhotos[0]!] }));
        openMenu('Actions for photo 1, the cover');

        expect(MENU_ITEMS.map(itemState)).toEqual(['disabled', 'disabled', 'disabled', 'enabled', 'enabled']);
    });

    it('reports each choice upward with the photo id', () => {
        const onSetCover = vi.fn();
        const onMovePhoto = vi.fn();
        const onReplacePhoto = vi.fn();
        const onRemovePhoto = vi.fn();
        renderManager(allWired({ onSetCover, onMovePhoto, onReplacePhoto, onRemovePhoto }));

        for (const name of MENU_ITEMS) {
            openMenu('Actions for photo 2');
            fireEvent.click(screen.getByRole('menuitem', { name }));
            // The chosen item runs once the sheet is off screen (iOS reports that through the Modal's onDismiss).
            act(() => modal.dismiss());
        }

        expect(onSetCover).toHaveBeenCalledExactlyOnceWith('ph_2');
        expect(onMovePhoto.mock.calls).toEqual([
            ['ph_2', 'earlier'],
            ['ph_2', 'later'],
        ]);
        expect(onReplacePhoto).toHaveBeenCalledExactlyOnceWith('ph_2');
        expect(onRemovePhoto).toHaveBeenCalledExactlyOnceWith('ph_2');
    });

    it('runs nothing for a disabled item', () => {
        const onMovePhoto = vi.fn();
        renderManager(allWired({ onMovePhoto }));
        openMenu('Actions for photo 1, the cover');

        fireEvent.click(screen.getByRole('menuitem', { name: 'Move earlier' }));
        act(() => modal.dismiss());

        expect(onMovePhoto).not.toHaveBeenCalled();
    });

    it('offers only what the container wired: no cover badge, no Set as cover, no moves, no Replace', () => {
        renderManager({ photos: threePhotos });
        openMenu('Actions for photo 2');

        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Remove']);
        expect(screen.queryByText('Cover')).toBeNull();
    });

    it('shows the "Cover" badge on the FIRST photo only, as text', () => {
        renderManager(allWired());

        expect(screen.getAllByText('Cover')).toHaveLength(1);
    });

    it('moves the badge and the cover reading to the next photo once the former cover is removed', () => {
        const { rerender } = render(<RecipePhotoManager photos={threePhotos} onRemovePhoto={noop} onSetCover={noop} />);
        expect(screen.getByRole('button', { name: 'Actions for photo 1, the cover' })).toBeTruthy();

        rerender(<RecipePhotoManager photos={threePhotos.slice(1)} onRemovePhoto={noop} onSetCover={noop} />);

        expect(screen.getAllByText('Cover')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Actions for photo 1, the cover' })).toBeTruthy();
    });

    it('keeps Replace and Remove but disables Set as cover and both moves while a reorder is in flight', () => {
        renderManager(allWired({ reordering: true }));
        openMenu('Actions for photo 2');

        expect(MENU_ITEMS.map(itemState)).toEqual(['disabled', 'disabled', 'disabled', 'enabled', 'enabled']);
    });

    /**
     * REWRITTEN from the Remove pill: the tile whose removal is in flight cannot open its menu (the trigger reports
     * `aria-disabled` and keeps the screen-reader cursor) and says "Removing…" as text; its siblings are untouched.
     */
    it('busies only the photo whose removal is in flight: its menu will not open and it says so', () => {
        renderManager(allWired({ removingPhotoId: 'ph_2' }));

        const removing = screen.getByRole('button', { name: 'Actions for photo 2' });
        expect(removing.getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByText('Removing…')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Actions for photo 3' }).getAttribute('aria-disabled')).not.toBe(
            'true',
        );

        fireEvent.click(removing);
        expect(screen.queryByRole('menuitem')).toBeNull();
    });
});

describe('RecipePhotoManager (native) — a queue tile’s actions (2026-10-17)', () => {
    const retryable = makeQueueItem({ fileId: 7, fileName: 'burnt.png', status: 'failed', retryable: true });

    it('gives an uploading file no controls at all — its status is the whole tile', () => {
        renderManager({ queueItems: [makeQueueItem({ fileId: 1, fileName: 'a.png', status: 'uploading' })] });

        expect(screen.queryByRole('button')).toBeNull();
    });

    it('gives a queued file a ⋯ menu holding Remove', () => {
        const onRemoveQueueItem = vi.fn();
        renderManager({
            queueItems: [makeQueueItem({ fileId: 4, fileName: 'a.png', status: 'queued' })],
            onRemoveQueueItem,
        });

        openMenu('Actions for a.png');
        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Remove']);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
        act(() => modal.dismiss());

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

        expect(screen.queryByRole('button', { name: 'Actions for a.png' })).toBeNull();
    });

    /**
     * DECISION: Retry stays a VISIBLE button on the failed tile, not a menu item. Retry is the one recovery for the
     * tile's headline state, so it is one tap, at the design system's `Button` size (48 dp on Android); Remove, the rarer
     * and destructive half, moves into the ⋯ menu with the other tiles' actions.
     */
    it.each([
        ['ios', 44],
        ['android', 48],
    ] as const)(
        'keeps Retry a visible %s button of at least %i on a retryable failed file, with Remove in its menu',
        (os, size) => {
            platform.os = os;
            const onRetryQueueItem = vi.fn();
            const onRemoveQueueItem = vi.fn();
            renderManager({ queueItems: [retryable], onRetryQueueItem, onRemoveQueueItem });

            const retry = screen.getByRole('button', { name: 'Retry upload of burnt.png' });
            // The Button's pill carries the floor as a `minHeight` (44 pt; 48 dp on Android): the tallest across the control.
            const tallest = Math.max(
                ...[retry, ...Array.from(retry.querySelectorAll('*'))].map(
                    (node) => Number.parseFloat(getComputedStyle(node).minHeight) || 0,
                ),
            );
            expect(tallest).toBeGreaterThanOrEqual(size);

            fireEvent.click(retry);
            expect(onRetryQueueItem).toHaveBeenCalledWith(7);

            openMenu('Actions for burnt.png');
            fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
            act(() => modal.dismiss());
            expect(onRemoveQueueItem).toHaveBeenCalledWith(7);
        },
    );

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

        expect(screen.getByText('That photo is larger than 5 MB.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Retry upload of huge.png' })).toBeNull();
        openMenu('Actions for huge.png');
        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Remove']);
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

/**
 * `docs/design/nativeContainerNames.md` N1 rule 2: the manager's heading says its name, so the manager carries none and
 * the heading is the one node that says it (N4). Both bodies are checked.
 */
describe('RecipePhotoManager (native) — N1: the manager’s name is said once, by its heading', () => {
    it.each([
        ['empty', []],
        ['populated', threePhotos],
    ])('says "Photos" through one header, and no node is labelled with it (%s)', (_body, photos) => {
        renderManager({ photos });

        expect(screen.getAllByRole('heading', { name: 'Photos' })).toHaveLength(1);
        expect(screen.queryAllByLabelText('Photos')).toEqual([]);
    });
});

/**
 * D15: the manager paints from colour roles at render, so it follows the device's scheme. Chrome on a photo is the
 * `photoChip` disc under an `ink` label (`darkTheme.md` §1 and §3.4: 10.64:1 light, 8.91:1 dark over a white photo),
 * the cover badge is the `action` fill under its `onAction` label, and a failed upload's badge is the `danger` fill.
 */
describe.each(['light', 'dark'] as const)('RecipePhotoManager (native) — the %s scheme', (scheme) => {
    const colours = scheme === 'dark' ? roleDark : role;
    const style = (element: Element): CSSStyleDeclaration => getComputedStyle(element);

    /**
     * REWRITES the D15 case that pinned the heading in `ink` at a hand-sized 18: buildSpec §7.7 draws the section name
     * as an H3 in the `label` role, muted — the Details group heading's style — and the empty copy is muted too.
     */
    it('paints the heading as a muted label-role H3, and the empty copy in inkMuted', () => {
        systemScheme.current = scheme;
        renderManager();
        const heading = style(screen.getByRole('heading', { name: 'Photos' }));

        expect(heading.color).toBe(rgb(colours.inkMuted));
        expect(heading.fontSize).toBe(`${nativeTokens.type.label.fontSize}px`);
        expect(style(screen.getByText('No photo? This cover is used instead. Add one any time.')).color).toBe(
            rgb(colours.inkMuted),
        );
    });

    it('draws the cover badge on the action fill under its onAction label', () => {
        systemScheme.current = scheme;
        renderManager({ photos: threePhotos, onSetCover: noop });
        const badge = screen.getByText('Cover');

        expect(style(badge).backgroundColor).toBe(rgb(colours.action));
        expect(style(badge).color).toBe(rgb(colours.onAction));
    });

    it('draws a queued upload’s status as a photoChip badge, and a failed one on the danger fill', () => {
        systemScheme.current = scheme;
        renderManager({
            queueItems: [
                makeQueueItem({ fileId: 1, fileName: 'a.jpg', status: 'queued' }),
                makeQueueItem({ fileId: 2, fileName: 'b.jpg', status: 'failed', errorMessage: 'Too large' }),
            ],
        });

        expect(style(screen.getByText('Queued')).backgroundColor).toBe(colours.photoChip);
        expect(style(screen.getByText('Upload failed')).backgroundColor).toBe(rgb(colours.danger));
        expect(style(screen.getByText('Too large')).color).toBe(rgb(colours.dangerText));
    });
});
