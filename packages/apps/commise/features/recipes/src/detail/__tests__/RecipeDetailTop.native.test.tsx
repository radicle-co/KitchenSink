/**
 * The top of the native recipe page, as `RecipeDetailAndroid384` draws it (`nativeBoards/buildLists.md` items 2 to 9,
 * `designAnswers.md` D1 to D5): the rating card, the cuisine eyebrow, a title that never truncates, the status row,
 * the source line, three fact tiles, the text actions and the Screen on row. react-native-web under jsdom.
 *
 * Left out on purpose, and asserted absent so a later slice must change this file: the "8 comments" row and "Start
 * cooking" (D1, D2: neither feature exists yet) and "Add to plan" (meal plans have not shipped).
 */
import type { FC, ReactElement, ReactNode } from 'react';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { render as renderInDesignSystem, resolvedColour, resolvedStyle } from '@commise/ui/testing/tamagui';
import { nativeTokens } from '@commise/ui/native';
import { rgb } from '@commise/ui/testing/system-color-scheme';
import { themeFor } from '@commise/ui/theme';
import { guardedFoodClient } from '@commise/test-utils';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { idleUnreachableRetry, makeRecipeDetail } from '../../__fixtures__/index.js';
import { CookMarksTestProvider } from '../../__fixtures__/cookMarks.js';
import { recipeMessages } from '../../messages.js';
import { resetServingScale } from '../servingScale.js';
import { RecipeDetailView } from '../RecipeDetailView.native.js';

const { detail } = recipeMessages.en;

const device = vi.hoisted(() => ({ width: 390, fontScale: 1 }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        useWindowDimensions: () => ({
            ...actual.Dimensions.get('window'),
            width: device.width,
            fontScale: device.fontScale,
        }),
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
    };
});

beforeEach(() => {
    device.width = 390;
    device.fontScale = 1;
    resetServingScale();
});

afterEach(cleanup);

/** The owner's view also mounts the ambiguity review, which reads the recipe and food clients. */
const OwnerScope: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <QueryClientProvider client={new QueryClient()}>
        <RecipeServiceProvider client={createFakeRecipeServiceClient()}>
            <FoodServiceProvider client={guardedFoodClient()} subject="user_test">
                <CookMarksTestProvider>{children}</CookMarksTestProvider>
            </FoodServiceProvider>
        </RecipeServiceProvider>
    </QueryClientProvider>
);

const render = (ui: ReactElement) => renderInDesignSystem(ui, { wrapper: OwnerScope });

interface ViewOptions {
    readonly viewerIsOwner?: boolean;
    readonly onViewVersions?: () => void;
    readonly headerActions?: ReactNode;
    readonly rating?: ReactNode;
}

const view = (recipe = makeRecipeDetail(), options: ViewOptions = {}): ReactElement => (
    <RecipeDetailView unreachableRetry={idleUnreachableRetry} recipe={recipe} {...options} />
);

/** Whether `later` comes after `earlier` in document order. */
const follows = (earlier: Element, later: Element): boolean =>
    Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);

/** The recipe title as the page's header, named by its text (several headings share the page). */
const titleOf = (title = makeRecipeDetail().title): HTMLElement => screen.getByRole('heading', { name: title });

const LONG_TITLE =
    'Slow-roasted lamb shoulder with anchovy, rosemary, garlic and a very long list of other things'.repeat(1) +
    ', then the same again'.repeat(3);

describe('RecipeDetailView (native) — the title and its eyebrow', () => {
    it('shows the cuisine alone as the eyebrow, above the title and apart from any byline', () => {
        render(view(makeRecipeDetail({ cuisine: 'British', authorUsername: 'ana', authorDisplayName: 'Ana' })));

        const eyebrow = screen.getByText('British');
        const title = titleOf();

        expect(eyebrow.textContent).toBe('British');
        expect(follows(eyebrow, title)).toBe(true);
    });

    it('says the cuisine once, as the eyebrow, even with no photo: the band carries no cuisine label', () => {
        render(view(makeRecipeDetail({ cuisine: 'British', photos: [] })));

        expect(screen.getAllByText('British')).toHaveLength(1);
    });

    it('draws no eyebrow for a recipe with no cuisine', () => {
        render(view(makeRecipeDetail({ cuisine: undefined })));

        expect(screen.queryByText('British')).toBeNull();
    });

    it('never truncates the title: all of a long title is in the page and no line clamp is set on it', () => {
        render(view(makeRecipeDetail({ title: LONG_TITLE })));

        const title = titleOf(LONG_TITLE);

        expect(title.textContent).toBe(LONG_TITLE);
        expect(resolvedStyle(title, 'webkitLineClamp')).not.toMatch(/^[1-9]/u);
    });

    it('wraps a long title at twice the system text scale without clamping it', () => {
        device.fontScale = 2;
        render(view(makeRecipeDetail({ title: LONG_TITLE })));

        expect(titleOf(LONG_TITLE).textContent).toBe(LONG_TITLE);
    });

    // Designer finding H-1 (iOS review): the title read "Trayb…" at the iOS cap. At a scale ABOVE 2 the whole title still
    // wraps: no line clamp on it, and nothing between it and the page that fixes a height or hides its overflow.
    it.each([2.5, 3])(
        'wraps the whole title at a system text scale of %s, with no height or clip around it',
        (scale) => {
            device.fontScale = scale;
            render(view(makeRecipeDetail({ title: LONG_TITLE })));

            const title = titleOf(LONG_TITLE);

            expect(title.textContent).toBe(LONG_TITLE);
            expect(resolvedStyle(title, 'webkitLineClamp')).not.toMatch(/^[1-9]/u);

            for (
                let node: HTMLElement | null = title;
                node !== null && node !== document.body;
                node = node.parentElement
            ) {
                if (node.getAttribute('data-scroll-root') !== null) {
                    break;
                }

                const style = getComputedStyle(node);

                expect(style.maxHeight, `a max height on ${node.tagName}`).toMatch(/^(none|)$/u);
                expect(style.textOverflow, `an ellipsis on ${node.tagName}`).not.toBe('ellipsis');
            }
        },
    );
});

describe('RecipeDetailView (native) — the rating card (D3)', () => {
    const rating = <div role="group" aria-label="Rating slot" />;

    it('puts the rating slot first in the top block, above the eyebrow and the title', () => {
        render(view(makeRecipeDetail({ cuisine: 'British' }), { rating }));

        const slot = screen.getByRole('group', { name: 'Rating slot' });

        expect(follows(slot, screen.getByText('British'))).toBe(true);
        expect(follows(slot, titleOf())).toBe(true);
    });

    it('draws the rating slot once: there is no lower rating section', () => {
        render(view(makeRecipeDetail(), { rating }));

        expect(screen.getAllByRole('group', { name: 'Rating slot' })).toHaveLength(1);
    });

    it('leaves out the comments row until comments ship (D1)', () => {
        render(view(makeRecipeDetail(), { rating }));

        expect(screen.queryByText(/comments?$/iu)).toBeNull();
    });
});

describe('RecipeDetailView (native) — the status row', () => {
    const owned = makeRecipeDetail({ status: RecipeStatus.PUBLISHED, visibility: RecipeVisibility.PUBLIC });

    it('shows the owner the visibility and the version history link, in one row under the title', () => {
        render(view(owned, { viewerIsOwner: true, onViewVersions: vi.fn() }));

        const visibility = screen.getByText(detail.visibilityPublic);
        const versions = screen.getByRole('button', { name: detail.versionHistory });

        expect(follows(titleOf(), visibility)).toBe(true);
        expect(visibility.closest('[name="DetailStatusRow"]')).toBe(versions.closest('[name="DetailStatusRow"]'));
    });

    // Designer, iosBatch2: at the cap "Public ·" ended a line and "Version history" wrapped alone. A separator never ends a line:
    // it is joined to the item after it as one unit, so they wrap together.
    it('joins the separator to the version link as one unit, apart from the visibility', () => {
        render(view(owned, { viewerIsOwner: true, onViewVersions: vi.fn() }));

        const separator = screen.getByText('·');
        const versions = screen.getByRole('button', { name: detail.versionHistory });
        const visibility = screen.getByText(detail.visibilityPublic);

        const unit = separator.parentElement as HTMLElement;

        expect(unit.getAttribute('name')).toBe('DetailStatusUnit');
        expect(unit.contains(versions)).toBe(true);
        expect(unit.contains(visibility)).toBe(false);
        expect(follows(separator, versions)).toBe(true);
    });

    it('opens the version history from the link', () => {
        const onViewVersions = vi.fn();
        render(view(owned, { viewerIsOwner: true, onViewVersions }));

        fireEvent.click(screen.getByRole('button', { name: detail.versionHistory }));

        expect(onViewVersions).toHaveBeenCalledTimes(1);
    });

    it('shows Draft instead of a visibility for the owner’s draft', () => {
        render(
            view(makeRecipeDetail({ status: RecipeStatus.DRAFT, visibility: RecipeVisibility.PRIVATE }), {
                viewerIsOwner: true,
            }),
        );

        expect(screen.getByText('Draft')).toBeTruthy();
        expect(screen.queryByText(detail.visibilityPrivate)).toBeNull();
    });

    it('shows another cook’s viewer no status and no version history', () => {
        render(view(owned, { viewerIsOwner: false }));

        expect(screen.queryByText(detail.visibilityPublic)).toBeNull();
        expect(screen.queryByRole('button', { name: detail.versionHistory })).toBeNull();
    });
});

describe('RecipeDetailView (native) — the source line', () => {
    it('says "Adapted from" with the source host as a link, between the title and the fact tiles', () => {
        render(view(makeRecipeDetail({ sourceUrl: 'https://example.com/lamb', sourceAttribution: 'Ana Lima' })));

        const label = screen.getByText(detail.sourceHeading);
        const link = screen.getByRole('link', { name: 'example.com' });

        expect(label.textContent).toBe('Adapted from');
        expect(follows(titleOf(), label)).toBe(true);
        expect(follows(label, screen.getByText(detail.totalLabel))).toBe(true);
        expect(follows(label, link)).toBe(true);
    });

    it('draws no source line, and no footer source, for a recipe with no source', () => {
        render(view(makeRecipeDetail({ sourceUrl: undefined, sourceAttribution: undefined })));

        expect(screen.queryByText(detail.sourceHeading)).toBeNull();
    });
});

/** The tile named for `label`: a group whose name starts with it, so a tile is read as one fact. */
const tileOf = (label: string): HTMLElement => screen.getByRole('group', { name: new RegExp(`^${label}`, 'u') });

describe('RecipeDetailView (native) — the fact tiles (D5)', () => {
    const timed = makeRecipeDetail({
        prepTimeMinutes: 20,
        cookTimeMinutes: 90,
        totalTimeMinutes: 110,
        difficulty: 'medium',
    });

    it('draws Total, Prep and Difficulty in that order, and no Cook tile', () => {
        render(view(timed));

        const labels = [detail.totalLabel, detail.prepLabel, detail.difficultyLabel].map((label) =>
            screen.getByText(label),
        );

        expect(follows(labels[0] as Element, labels[1] as Element)).toBe(true);
        expect(follows(labels[1] as Element, labels[2] as Element)).toBe(true);
        expect(screen.queryByText('Cook')).toBeNull();
    });

    it('paints every tile with the cover-steel tint', () => {
        render(view(timed));

        for (const label of [detail.totalLabel, detail.prepLabel, detail.difficultyLabel]) {
            expect(resolvedColour(tileOf(label), 'backgroundColor'), label).toBe(rgb(themeFor('light').covers.steel));
        }
    });

    it('keeps all three tiles at twice the text scale and a narrow phone', () => {
        device.width = 320;
        device.fontScale = 2;
        render(view(timed));

        for (const label of [detail.totalLabel, detail.prepLabel, detail.difficultyLabel]) {
            expect(tileOf(label)).toBeTruthy();
        }
    });

    // Designer, iosBatch2: Difficulty is plain text in the tile's value style, as on the board and the cards. It was the
    // difficulty badge, which truncated ("Medi…") in a narrow tile.
    it('says the difficulty as plain text in the same value style as the other tiles', () => {
        render(view(timed));

        const difficulty = within(tileOf(detail.difficultyLabel)).getByText('Medium');
        const total = within(tileOf(detail.totalLabel)).getByText('1 h 50 min');

        expect(resolvedStyle(difficulty, 'fontFamily')).toBe(resolvedStyle(total, 'fontFamily'));
        expect(resolvedStyle(difficulty, 'fontSize')).toBe(resolvedStyle(total, 'fontSize'));
        // The badge drew the word inside a meter; plain text is the word alone, in a text node of its own.
        expect(difficulty.children).toHaveLength(0);
        expect(tileOf(detail.difficultyLabel).querySelector('[role="img"], [data-difficulty]')).toBeNull();
    });

    // Designer, iosBatch2: three across only while (tile width / capped text scale) >= 100 pt; below that, one tile to a row,
    // the label at the start and the value at the end.
    describe('the tiles’ rows', () => {
        const directionOf = (label: string): string => resolvedStyle(tileOf(label), 'flexDirection');
        const rowOf = (): HTMLElement => tileOf(detail.totalLabel).parentElement as HTMLElement;

        it('draws three across, label over value, while each tile has 100 pt per unit of text scale', () => {
            device.width = 390;
            device.fontScale = 1;
            render(view(timed));

            expect(rowOf().children).toHaveLength(3);
            expect(directionOf(detail.totalLabel)).toBe('column');
            expect(resolvedStyle(rowOf(), 'flexDirection')).toBe('row');
        });

        it('draws one tile to a row, label at the start and value at the end, at the 2x cap', () => {
            device.width = 390;
            device.fontScale = 2;
            render(view(timed));

            expect(resolvedStyle(rowOf(), 'flexDirection')).toBe('column');
            expect(directionOf(detail.totalLabel)).toBe('row');
            expect(resolvedStyle(tileOf(detail.totalLabel), 'justifyContent')).toBe('space-between');
        });

        it('reads the scale the text is drawn at: the cap, not a system scale of 3.1', () => {
            device.width = 390;
            device.fontScale = 3.1;
            render(view(timed));

            expect(resolvedStyle(rowOf(), 'flexDirection')).toBe('column');
        });

        it('goes one to a row on a narrow phone even at the default scale', () => {
            device.width = 320;
            device.fontScale = 1;
            render(view(timed));

            expect(resolvedStyle(rowOf(), 'flexDirection')).toBe('column');
        });
    });

    it('hides the tile of a missing time rather than saying "0 min"', () => {
        render(view(makeRecipeDetail({ prepTimeMinutes: 0, totalTimeMinutes: 30, difficulty: undefined })));

        expect(screen.queryByText(detail.prepLabel)).toBeNull();
        expect(screen.getByText(detail.totalLabel)).toBeTruthy();
    });

    it('draws the three tiles in one row at a phone width, space-2 apart', () => {
        render(view(timed));

        const row = tileOf(detail.totalLabel).parentElement as HTMLElement;

        expect(within(row).getAllByRole('group')).toHaveLength(3);
        expect(resolvedStyle(row, 'gap')).toBe(`${String(nativeTokens.spacing[2])}px`);
    });
});

describe('RecipeDetailView (native) — the actions (D2)', () => {
    it('draws the host’s text action and no "Start cooking" and no "Add to plan"', () => {
        render(view(makeRecipeDetail(), { headerActions: <button type="button">Edit recipe</button> }));

        expect(screen.getByRole('button', { name: 'Edit recipe' })).toBeTruthy();
        expect(screen.queryByText('Start cooking')).toBeNull();
        expect(screen.queryByText('Add to plan')).toBeNull();
    });
});

describe('RecipeDetailView (native) — Screen on is a row in the page, with no section switch', () => {
    it('draws no section switch below a 720 pt body, and nothing sticky', () => {
        render(view());

        expect(screen.queryByRole('navigation', { name: 'Recipe sections' })).toBeNull();
        expect(screen.queryByRole('link', { name: 'Nutrition' })).toBeNull();
    });

    // REWRITTEN IN SLICE 1 (designer, iosBatch1): "Screen on" is a quiet action IN the action row, after Edit recipe, as a switch with its
    // checked state; there is no caption under it.
    it('draws one Screen on switch in the action row, after the host’s action, with no caption', () => {
        render(view(makeRecipeDetail(), { headerActions: <button type="button">Edit recipe</button> }));

        const toggles = screen.getAllByRole('switch', { name: detail.screenOn });
        const edit = screen.getByRole('button', { name: 'Edit recipe' });

        expect(toggles).toHaveLength(1);
        expect(toggles[0]?.getAttribute('aria-checked')).toBe('false');
        expect(follows(edit, toggles[0] as HTMLElement)).toBe(true);
        expect(edit.parentElement?.contains(toggles[0] as HTMLElement)).toBe(true);
        // The sentence is the switch's accessibility hint only, never drawn (the hint itself is asserted in
        // `RecipeDetailScreenOnHint.native.test.tsx`, because react-native-web does not render it).
        expect(screen.queryByText(detail.screenOnHint)).toBeNull();
    });

    it('draws Screen on even when the host offers no action, and reports checked once turned on', () => {
        render(view());

        fireEvent.click(screen.getByRole('switch', { name: detail.screenOn }));

        expect(screen.getByRole('switch', { name: detail.screenOn }).getAttribute('aria-checked')).toBe('true');
    });
});
