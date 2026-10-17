/**
 * Native component tests for the recipe photo manager (T067), rendered via react-native-web under jsdom.
 * Mirrors the web leaf across every state — empty, populated, per-photo removing-busy, upload status, error,
 * and the add-control/cap boundary — so the two platform renders cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { Pressable, Text } from 'react-native';

import { role, roleDark } from '@commise/ui/colors';
import { nativeTokens } from '@commise/ui/native';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';

import { makePhoto, makeQueueItem } from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipePhotoManager } from '../RecipePhotoManager.native.js';
import { MAX_RECIPE_PHOTOS, type RecipePhotoManagerProps } from '../model.js';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

afterEach(() => {
    cleanup();
    systemScheme.current = null;
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

    /**
     * The case above only proved the DISABLED half reaches the DOM — and it does so for free, because RNW
     * derives `aria-disabled` from the `disabled` PROP. The BUSY half did not (#123): react-native-web 0.20.0's
     * `forwardedProps` allowlist carries every literal `aria-*` attribute but has NO entry that projects
     * `accessibilityState` (its only consumer anywhere in the package, `AccessibilityUtil/isDisabled`, reads the
     * LEGACY `accessibilityStates` array). So the in-flight remove was announced as merely unavailable, not as
     * working — and "unavailable" and "working" are different things for a control the user just pressed. The
     * "Removing…" label swap is inside the button, but the button carries an explicit `accessibilityLabel`
     * ("Remove photo N"), which OVERRIDES its text content for assistive tech — so that swap is sighted-only.
     *
     * `aria-busy` is RN's own first-class ALIAS for `accessibilityState.busy` (`ViewAccessibility.d.ts`), so it
     * is device-correct too, and the object form stays (RN reverse-maps `aria-busy` into
     * `accessibilityState.busy`).
     */
    it('marks the in-flight remove control busy in the DOM, not only disabled', () => {
        renderManager({ photos: threePhotos, removingPhotoId: 'ph_2' });

        expect(screen.getByRole('button', { name: 'Remove photo 2' }).getAttribute('aria-busy')).toBe('true');
    });

    it('busies ONLY the removing row — its siblings are disabled, not busy', () => {
        // Mutation guard: an unconditional `aria-busy` would pass the case above. Exactly one row is busy.
        renderManager({ photos: threePhotos, removingPhotoId: 'ph_2' });

        const busy = screen
            .getAllByRole('button', { name: /^Remove photo/ })
            .filter((button) => button.getAttribute('aria-busy') === 'true')
            .map((button) => button.getAttribute('aria-label'));

        expect(busy).toEqual(['Remove photo 2']);
    });

    it('leaves every remove control unmarked when no removal is in flight', () => {
        renderManager({ photos: threePhotos });

        screen.getAllByRole('button', { name: /^Remove photo/ }).forEach((button) => {
            expect(button.getAttribute('aria-busy')).toBeNull();
        });
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

describe('RecipePhotoManager (native) — per-photo cover selection (U6)', () => {
    it('renders no cover badge and no cover radios when onSetCover is not wired (feature gated)', () => {
        renderManager({ photos: threePhotos });

        expect(screen.queryByText('Cover')).toBeNull();
        expect(screen.queryAllByRole('radio')).toHaveLength(0);
    });

    it('shows the "Cover" badge on the FIRST photo only (cover defaults to index 0)', () => {
        renderManager({ photos: threePhotos, onSetCover: noop });

        expect(screen.getAllByText('Cover')).toHaveLength(1);
        // On the first photo's cell — which is the cell holding photo 1's image — and on no other.
        const first = screen.getByLabelText('Recipe photo 1').parentElement as HTMLElement;
        expect(within(first).getByText('Cover')).toBeTruthy();
        const second = screen.getByLabelText('Recipe photo 2').parentElement as HTMLElement;
        expect(within(second).queryByText('Cover')).toBeNull();
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

        expect(screen.queryByRole('button', { name: 'Remove a.png' })).toBeNull();
    });

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

    it('draws Remove on a photo as a photoChip disc with an ink label', () => {
        systemScheme.current = scheme;
        renderManager({ photos: threePhotos });
        const remove = screen.getByRole('button', { name: 'Remove photo 1' });

        expect(style(remove).backgroundColor).toBe(colours.photoChip);
        expect(style(screen.getAllByText('Remove')[0] as Element).color).toBe(rgb(colours.ink));
    });

    it('draws the cover badge on the action fill, and the chosen cover radio filled with selectedEdge', () => {
        systemScheme.current = scheme;
        renderManager({ photos: threePhotos, onSetCover: noop });
        const badge = screen.getByText('Cover');

        expect(style(badge).backgroundColor).toBe(rgb(colours.action));
        expect(style(badge).color).toBe(rgb(colours.onAction));

        const dot = screen.getByRole('radio', { name: 'Set photo 1 as cover' }).firstElementChild;

        if (dot === null) {
            throw new Error('no radio dot');
        }

        expect(style(dot).backgroundColor).toBe(rgb(colours.selectedEdge));
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
