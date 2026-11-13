// @vitest-environment jsdom
/**
 * The top of the web recipe page, as `RecipeDetailAndroid384` draws it (`nativeBoards/buildLists.md` items 2 to 9,
 * `designAnswers.md` section "2026-11-02: card, Home header and Recipe detail build questions"): the rating card, the
 * cuisine eyebrow, a title that never truncates, the status row, the
 * source line, three fact tiles, the text actions and the Screen on row. The web twin of
 * `RecipeDetailTop.native.test.tsx`: the two pages say the same things in the same order.
 *
 * Left out on purpose, and asserted absent: the "8 comments" row (D1) and "Add to plan" (meal plans have not shipped).
 * "Start cooking" is drawn only when the recipe can be cooked and the app binds the cooking route, so a view with neither still shows none.
 */
import { renderWithRecipeClient } from '@commise/test-utils';
import { FoodServiceClient } from '@kitchensink/food-service-client';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { cleanup, fireEvent, type render as renderUnscoped, screen, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { idleUnreachableRetry, makePhoto, makeRecipeDetail } from '../../__fixtures__/index.js';
import { DetailTestScope } from '../../__fixtures__/detailScope.js';
import { recipeActionMessages } from '../../actions/messages.js';
import { recipeMessages } from '../../messages.js';
import { RecipeDetailView } from '../RecipeDetailView.js';
import { START_COOKING_GLYPH } from '../startCookingGlyph.js';

const { detail } = recipeMessages.en;

afterEach(cleanup);

/** The owner's view also mounts the ambiguity review, which reads the recipe and food clients. */
const render = (ui: ReactElement): ReturnType<typeof renderUnscoped> =>
    renderWithRecipeClient(
        <FoodServiceProvider
            client={
                new FoodServiceClient({
                    baseUrl: 'https://food.test',
                    fetch: () => Promise.reject(new Error('offline')),
                })
            }
            subject="user_test"
        >
            <DetailTestScope>{ui}</DetailTestScope>
        </FoodServiceProvider>,
        createFakeRecipeServiceClient(),
    );

interface ViewOptions {
    readonly viewerIsOwner?: boolean;
    readonly versionsHref?: string;
    readonly headerActions?: ReactNode;
    readonly rating?: ReactNode;
}

const view = (recipe = makeRecipeDetail(), options: ViewOptions = {}): ReactElement => (
    <RecipeDetailView unreachableRetry={idleUnreachableRetry} recipe={recipe} {...options} />
);

const titleOf = (title = makeRecipeDetail().title): HTMLElement =>
    screen.getByRole('heading', { level: 1, name: title });

/** Whether `later` comes after `earlier` in document order. */
const follows = (earlier: Element, later: Element): boolean =>
    Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);

const LONG_TITLE = `Slow-roasted lamb shoulder with anchovy, rosemary, garlic${', and more of the same'.repeat(6)}`;

describe('RecipeDetailView (web) — the title and its eyebrow', () => {
    it('shows the cuisine alone as the eyebrow, above the title and apart from any byline', () => {
        render(
            view(
                makeRecipeDetail({
                    cuisine: 'British',
                    photos: [makePhoto()],
                    authorUsername: 'ana',
                    authorDisplayName: 'Ana',
                }),
            ),
        );

        const eyebrow = screen.getByText('British');

        expect(eyebrow.textContent).toBe('British');
        expect(follows(eyebrow, titleOf())).toBe(true);
    });

    it('says the cuisine once, as the eyebrow, even with no photo: the band carries no cuisine label', () => {
        render(view(makeRecipeDetail({ cuisine: 'British', photos: [] })));

        expect(screen.getAllByText('British')).toHaveLength(1);
    });

    it('draws no eyebrow for a recipe with no cuisine', () => {
        render(view(makeRecipeDetail({ cuisine: undefined })));

        expect(screen.queryByText('British')).toBeNull();
    });

    it('never truncates the title: all of it is in the page and no line clamp class is set on it', () => {
        render(view(makeRecipeDetail({ title: LONG_TITLE })));

        const title = titleOf(LONG_TITLE);

        expect(title.textContent).toBe(LONG_TITLE);
        expect(title.className).not.toMatch(/line-clamp|truncate/u);
        expect(title.getAttribute('title')).toBeNull();
    });
});

describe('RecipeDetailView (web) — the rating card (D3)', () => {
    const rating = <div role="group" aria-label="Rating slot" />;

    it('puts the rating slot first in the top block, above the eyebrow and the title', () => {
        render(view(makeRecipeDetail({ cuisine: 'British', photos: [makePhoto()] }), { rating }));

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

describe('RecipeDetailView (web) — the status row', () => {
    const owned = makeRecipeDetail({ status: RecipeStatus.PUBLISHED, visibility: RecipeVisibility.PUBLIC });

    it('shows the owner the visibility and the version history link, in one row under the title', () => {
        render(view(owned, { viewerIsOwner: true, versionsHref: '/en/recipes/r1/versions' }));

        const visibility = screen.getByText(detail.visibilityPublic);
        const versions = screen.getByRole('link', { name: detail.versionHistory });

        expect(follows(titleOf(), visibility)).toBe(true);
        expect(visibility.closest('p, div')?.contains(versions)).toBe(true);
        expect(versions.getAttribute('href')).toBe('/en/recipes/r1/versions');
    });

    // REPLACED (designer ruling after iosBatch2): no separator glyph; the wrapping row is pinned in `RecipeDetailView.test.tsx`.
    it('draws no separator between the visibility and the version link', () => {
        render(view(owned, { viewerIsOwner: true, versionsHref: '/en/recipes/r1/versions' }));

        expect(screen.queryByText('·')).toBeNull();
        expect(screen.getByRole('link', { name: detail.versionHistory })).toBeTruthy();
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
        expect(screen.queryByRole('link', { name: detail.versionHistory })).toBeNull();
    });
});

describe('RecipeDetailView (web) — the source line', () => {
    it('says "Adapted from" with the source host as a link, between the title and the fact tiles', () => {
        render(view(makeRecipeDetail({ sourceUrl: 'https://example.com/lamb', sourceAttribution: 'Ana Lima' })));

        const label = screen.getByText(detail.sourceHeading);

        expect(label.textContent).toBe('Adapted from');
        expect(follows(titleOf(), label)).toBe(true);
        expect(follows(label, screen.getByText(detail.totalLabel))).toBe(true);
        expect(follows(label, screen.getByRole('link', { name: 'example.com' }))).toBe(true);
    });

    it('draws no source line for a recipe with no source', () => {
        render(view(makeRecipeDetail({ sourceUrl: undefined, sourceAttribution: undefined })));

        expect(screen.queryByText(detail.sourceHeading)).toBeNull();
    });
});

describe('RecipeDetailView (web) — the fact tiles (D5)', () => {
    const timed = makeRecipeDetail({
        prepTimeMinutes: 20,
        cookTimeMinutes: 90,
        totalTimeMinutes: 110,
        difficulty: 'medium',
    });

    /** The tile for `label`: the list item that holds its term. */
    const tileOf = (label: string): HTMLElement => screen.getByText(label).closest('div') as HTMLElement;

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
            expect(tileOf(label).className, label).toContain('bg-cover-steel');
        }
    });

    it('hides the tile of a missing time rather than saying "0 min"', () => {
        render(view(makeRecipeDetail({ prepTimeMinutes: 0, totalTimeMinutes: 30, difficulty: undefined })));

        expect(screen.queryByText(detail.prepLabel)).toBeNull();
        expect(screen.getByText(detail.totalLabel)).toBeTruthy();
    });

    // Designer, iosBatch2: Difficulty is plain text in the tile's value style, as on the board and the cards (it was the badge).
    it('says the difficulty as plain text in the same value style as the other tiles', () => {
        render(view(timed));

        const difficulty = screen.getByText('Medium');
        const total = screen.getByText('1 h 50 min');

        expect(difficulty.tagName).toBe(total.tagName);
        expect(difficulty.className).toBe(total.className);
        expect(difficulty.className.split(' ')).toContain('text-figure-stat');
    });

    // Designer, iosBatch2: a tile holds 100 px per unit of text size; the minimum is in rem, so it grows with the text and the
    // tiles wrap to one a row instead of breaking a word.
    it('gives each tile a minimum width that grows with the text size', () => {
        render(view(timed));

        for (const label of [detail.totalLabel, detail.prepLabel, detail.difficultyLabel]) {
            expect(tileOf(label).className.split(' ')).toContain('min-w-[6.25rem]');
        }
    });

    it('draws the three tiles in one list, so they read as one set', () => {
        render(view(timed));

        const list = tileOf(detail.totalLabel).parentElement as HTMLElement;

        expect(within(list).getAllByText(/./u).length).toBeGreaterThanOrEqual(6);
        expect(list.contains(tileOf(detail.difficultyLabel))).toBe(true);
    });
});

describe('RecipeDetailView (web) — the actions (D2)', () => {
    it('draws the host’s text action and no "Start cooking" and no "Add to plan"', () => {
        render(view(makeRecipeDetail(), { headerActions: <button type="button">Edit recipe</button> }));

        expect(screen.getByRole('button', { name: 'Edit recipe' })).toBeTruthy();
        expect(screen.queryByText('Start cooking')).toBeNull();
        expect(screen.queryByText('Add to plan')).toBeNull();
    });
});

describe('RecipeDetailView (web) — Screen on is a quiet action in the action row, with no section switch', () => {
    const withWakeLock = (run: () => void): void => {
        Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
        Object.defineProperty(navigator, 'wakeLock', {
            value: { request: () => Promise.resolve({ released: false, release: () => Promise.resolve() }) },
            configurable: true,
        });

        try {
            run();
        } finally {
            Reflect.deleteProperty(navigator, 'wakeLock');
            Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
        }
    };

    it('draws no section switch at any width', () => {
        render(view());

        expect(screen.queryByRole('navigation', { name: 'Recipe sections' })).toBeNull();
        expect(screen.queryByRole('link', { name: 'Nutrition' })).toBeNull();
    });

    it('draws the Screen on switch in the same row as the host’s action, after it, with no caption', () => {
        withWakeLock(() => {
            render(view(makeRecipeDetail(), { headerActions: <button type="button">Edit recipe</button> }));

            const edit = screen.getByRole('button', { name: 'Edit recipe' });
            const toggle = screen.getByRole('switch', { name: 'Screen on' });

            expect(follows(edit, toggle)).toBe(true);
            expect(edit.parentElement?.contains(toggle)).toBe(true);
            // The designer keeps the sentence as the switch's description only: spoken after the name and state, never drawn.
            expect(toggle.getAttribute('aria-description')).toBe(detail.screenOnHint);
            expect(screen.queryByText(detail.screenOnHint)).toBeNull();
        });
    });
});

/**
 * The shared view draws the Start cooking row itself, on its own full-width row under the
 * fact tiles and above the action row (designer, canvas CookingModeEntry*). It is drawn only when the recipe can be cooked
 * (the controller's `canStartCooking`) AND the app bound `onStartCooking`; the apps own only where it goes.
 */
describe('RecipeDetailView (web) — the Start cooking row', () => {
    const cookable = (onStartCooking = vi.fn()): ReactElement => (
        <RecipeDetailView
            unreachableRetry={idleUnreachableRetry}
            recipe={makeRecipeDetail()}
            headerActions={<button type="button">Edit recipe</button>}
            canStartCooking
            onStartCooking={onStartCooking}
        />
    );

    it('draws Start cooking under the fact tiles and above the action row, on a row of its own', () => {
        render(cookable());

        const start = screen.getByRole('button', { name: recipeActionMessages.en.detailActions.startCooking });
        const edit = screen.getByRole('button', { name: 'Edit recipe' });

        expect(follows(screen.getByText(detail.totalLabel), start)).toBe(true);
        expect(follows(start, edit)).toBe(true);
        expect(edit.parentElement?.contains(start)).toBe(false);
    });

    it('is named by its label, and a press opens cooking mode', () => {
        const onStartCooking = vi.fn();
        render(cookable(onStartCooking));

        const start = screen.getByRole('button', { name: 'Start cooking' });
        fireEvent.click(start);

        expect(start.textContent).toContain('Start cooking');
        expect(onStartCooking).toHaveBeenCalledTimes(1);
    });

    it('draws the row’s one glyph, named once in START_COOKING_GLYPH', () => {
        render(cookable());

        const start = screen.getByRole('button', { name: 'Start cooking' });
        const glyphs = start.querySelectorAll('svg.lucide');
        // Lucide classes a glyph by its kebab-case name: cookingPot is lucide-cooking-pot.
        const lucideClass = `lucide-${START_COOKING_GLYPH.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`;

        expect(glyphs).toHaveLength(1);
        expect(glyphs[0]?.classList.contains(lucideClass)).toBe(true);
    });

    it('draws no row for a recipe that cannot be cooked, even with the route bound', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail()}
                canStartCooking={false}
                onStartCooking={vi.fn()}
            />,
        );

        expect(screen.queryByRole('button', { name: 'Start cooking' })).toBeNull();
    });

    it('draws no row when the app binds no cooking route', () => {
        render(
            <RecipeDetailView unreachableRetry={idleUnreachableRetry} recipe={makeRecipeDetail()} canStartCooking />,
        );

        expect(screen.queryByRole('button', { name: 'Start cooking' })).toBeNull();
    });
});
