// @vitest-environment jsdom
/**
 * U13 — the WEB half of the AMBIGUITY REVIEW surface: entry, disclosure, one row per ambiguous LINE with its fresh
 * shortlist, a pick that re-points THAT line alone (owner ruling 2026-10-02, "Fix one line at a time"), per-row
 * failure, the owner gate, and the one-time clone banner. Every state, absence cases included.
 *
 * The native mirror is `ambiguityReviewSurface.native.test.tsx`; the two assert the same set (§14).
 * The shortlist is the progressive food search (plan 002 S7.8; `docs/design/rowEditorOpenDecisions.md`, S7 list
 * contract P12), mocked at its seam (`useIngredientSuggestionSource`, whose suite runs it against the real client): our
 * database's foods first, then each remote source's under `From {source}`. A remote pick adopts first, through a
 * network-guarded food client whose `adoptRemoteFood` is stubbed. The pick runs for real: `useAmbiguityPick` and the client's rebind
 * hook over TanStack Query and a network-guarded client whose `rebindIngredientLine` is stubbed. The surface reads
 * the recipe from the query cache, as the detail containers do, so a taken pick's write-through re-renders it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeDataSource } from '../../dataSources/__fixtures__/makeDataSource.js';
import { QueryClient, useQuery } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithRecipeClient } from '@commise/test-utils';
import { FoodResolutionStatus, type RecipeDetail } from '@kitchensink/recipe-core';
import { recipeQueries, recipeServiceKeys } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { FoodServiceClient, RemoteFoodGoneError } from '@kitchensink/food-service-client';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import type { ProgressiveFrame } from '@kitchensink/food-service-client';

import { offlineNoticeMessages } from '@commise/features-core/offline';

import { commaJoinedTexts } from '../../__tests__/commaJoinedTexts.js';
import { makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
import { BRISKET_FLAT_HALF_PARTS } from '../__fixtures__/variantLines.js';
import { recipeFormMessages } from '../../form/messages.js';
import {
    COMPLETE_FRAME,
    answerOf,
    databaseFrame,
    remoteItem,
    sourceAnswered,
} from '../../__fixtures__/progressiveFrames.js';
import type { AuthoredFoodHit, CatalogFoodHit, ProgressiveRead } from '../../hooks/foodSuggestions.model.js';
import { recipeMessages } from '../../messages.js';

const { useIngredientSuggestionSourceMock } = vi.hoisted(() => ({ useIngredientSuggestionSourceMock: vi.fn() }));

vi.mock('../../hooks/ingredientSuggestionSource.js', () => ({
    useIngredientSuggestionSource: useIngredientSuggestionSourceMock,
}));

import { AmbiguityReview } from '../AmbiguityReview.js';

const en = recipeMessages.en.detail;
const form = recipeFormMessages.en;

const RECIPE_ID = '00000000-0000-4000-8000-00000000a001';
const PICK = { id: 'F_pick', name: 'Apple sauce, canned', score: 0.9 } satisfies CatalogFoodHit;
const MINE = { id: 'F_mine', name: 'apple sauce, homemade', score: 0.7 } satisfies AuthoredFoodHit;

const FLOUR = makeIngredientView({ ingredientId: '00000000-0000-4000-8000-0000000000f1', name: 'flour' });
/** Two lines with the SAME name, at stored positions 1 and 2: the fixture "one pick, one line" is about. */
const CUP = makeIngredientView({
    ingredientId: '00000000-0000-4000-8000-0000000000a1',
    name: 'apple sauce',
    quantity: { kind: 'exact', value: 1 },
    unit: 'cup',
    resolutionStatus: FoodResolutionStatus.AMBIGUOUS,
});
const SPOON = makeIngredientView({
    ingredientId: '00000000-0000-4000-8000-0000000000a2',
    name: 'apple sauce',
    quantity: { kind: 'exact', value: 2 },
    unit: 'tbsp',
    resolutionStatus: FoodResolutionStatus.AMBIGUOUS,
});
const CUP_ROW = '1 cup apple sauce';
const SPOON_ROW = '2 tbsp apple sauce';

/** A recipe whose lines are `ingredients`. */
const recipeOf = (ingredients: RecipeDetail['ingredients'], extra: Partial<RecipeDetail> = {}): RecipeDetail =>
    makeRecipeDetail({ id: RECIPE_ID, currentVersion: 4, ingredients, ...extra });

const SIBLINGS = recipeOf([FLOUR, CUP, SPOON]);

/** The recipe after the line at stored position 2 was re-pointed to `PICK`, as the rebind answers it. */
const SPOON_TAKEN = recipeOf([
    FLOUR,
    CUP,
    {
        ...SPOON,
        ingredientId: '00000000-0000-4000-8000-0000000000b2',
        name: PICK.name,
        foodId: PICK.id,
        resolutionStatus: FoodResolutionStatus.RESOLVED,
    },
]);

/** The food search's answer for a row, and Try again. */
function searched(read: ProgressiveRead, refetch = vi.fn()) {
    return { read, refetch };
}

/** An answer that ended after `frames`. */
const ended = (...frames: ProgressiveFrame[]): ProgressiveRead => ({
    kind: 'ended',
    answer: answerOf(...frames),
    resumed: false,
});

/** Our database answered: none of the cook's own, one catalog candidate. */
const settledSearch = () => searched(ended(databaseFrame({ catalog: [PICK] }), COMPLETE_FRAME));

/** The retry's name on the apple sauce rows: it names the line's words, because the page has one per row. */
const RETRY = en.ambiguousReviewRetryLabel.replace('{phrase}', 'apple sauce');

/** A rebind the test settles when it chooses. */
function heldRebind() {
    let settle: { resolve: (detail: RecipeDetail) => void; reject: (error: unknown) => void } | undefined;
    const answer = new Promise<RecipeDetail>((resolve, reject) => {
        settle = { resolve, reject };
    });

    return {
        answer,
        resolve: async (detail: RecipeDetail): Promise<void> => {
            await act(async () => {
                settle?.resolve(detail);
                await answer;
            });
        },
        reject: async (error: unknown): Promise<void> => {
            await act(async () => {
                settle?.reject(error);
                await answer.catch(() => undefined);
            });
        },
    };
}

/**
 * Render the surface over the recipe read, as a detail container does: the recipe is seeded into the query cache and
 * read back from it, so the rebind's write-through re-renders the surface.
 */
function renderReview(recipe: RecipeDetail, viewerIsOwner = true) {
    const client = createFakeRecipeServiceClient();
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
    });
    const rebind = vi.spyOn(client, 'rebindIngredientLine');
    const food = new FoodServiceClient({
        baseUrl: 'https://food.test',
        fetch: () => Promise.reject(new Error('unstubbed network call')),
    });
    const adopt = vi.spyOn(food, 'adoptRemoteFood');

    queryClient.setQueryData(recipeServiceKeys.recipe(recipe.id), recipe);
    vi.spyOn(food, 'listSources').mockResolvedValue({
        sources: [makeDataSource({ id: 'usda', shortName: 'USDA', name: 'USDA FoodData Central' })],
    });

    function Detail() {
        const { data } = useQuery({ ...recipeQueries(client).detail(recipe.id), staleTime: Infinity });

        return data === undefined ? null : <AmbiguityReview recipe={data} viewerIsOwner={viewerIsOwner} />;
    }

    return {
        ...renderWithRecipeClient(
            <FoodServiceProvider client={food} subject="user_1">
                <Detail />
            </FoodServiceProvider>,
            client,
            { queryClient },
        ),
        rebind,
        adopt,
    };
}

/** Open the review. */
const open = (): void => {
    fireEvent.click(screen.getByRole('button', { name: en.ambiguousReviewToggle }));
};

/** The review row for one line, by the line's own words. */
const row = (name: string): HTMLElement => screen.getByRole('group', { name });

beforeEach(() => {
    useIngredientSuggestionSourceMock.mockReturnValue(settledSearch());
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('AmbiguityReview (web) — every state', () => {
    it.each([true, false])(
        'renders NOTHING for a recipe with no ambiguity and no clone count (owner: %s) — the common case is silent',
        (viewerIsOwner) => {
            const { container } = renderReview(recipeOf([FLOUR]), viewerIsOwner);

            expect(container.innerHTML).toBe('');
        },
    );

    it('⛔ offers a viewer who does not own the recipe NO review: only the owner can re-point a line', () => {
        const { container } = renderReview(SIBLINGS, false);

        expect(screen.queryByRole('button', { name: en.ambiguousReviewToggle })).toBeNull();
        expect(screen.queryByText(en.ambiguousNoticeMany.replace('{count}', '2'))).toBeNull();
        expect(container.innerHTML).toBe('');
    });

    it('the ENTRY counts lines (singular), and the surface stays closed until toggled', () => {
        renderReview(recipeOf([CUP]));

        expect(screen.getByText(en.ambiguousNoticeOne)).toBeTruthy();
        // Closed: no row rendered, and NO search fired — dismissal-safe by construction.
        expect(screen.queryByRole('group', { name: CUP_ROW })).toBeNull();
        expect(useIngredientSuggestionSourceMock).not.toHaveBeenCalled();
    });

    it('the ENTRY counts LINES, so two same-named lines are two', () => {
        renderReview(SIBLINGS);

        expect(screen.getByText(en.ambiguousNoticeMany.replace('{count}', '2'))).toBeTruthy();
    });

    it('⛔ same-named lines are TWO rows, each its own line, each searching the line’s own name (gap 19)', () => {
        renderReview(SIBLINGS);
        open();

        expect(within(row(CUP_ROW)).getByRole('button', { name: PICK.name })).toBeTruthy();
        expect(within(row(SPOON_ROW)).getByRole('button', { name: PICK.name })).toBeTruthy();
        expect(useIngredientSuggestionSourceMock).toHaveBeenCalledWith('apple sauce', true, expect.any(Function));
    });

    it('⛔ ONE pick re-points ONE line: one rebind, at THAT line’s stored position and the version read', async () => {
        const { rebind } = renderReview(SIBLINGS);

        rebind.mockReturnValue(heldRebind().answer);
        open();
        fireEvent.click(within(row(SPOON_ROW)).getByRole('button', { name: PICK.name }));
        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));

        expect(rebind).toHaveBeenCalledTimes(1);
        expect(rebind).toHaveBeenCalledWith(RECIPE_ID, 2, {
            expectedVersion: 4,
            target: { kind: 'catalogFood', foodId: PICK.id },
        });
    });

    it('⛔ once the pick is taken its line leaves the review; the same-named line stays, still offering its list', async () => {
        const { rebind } = renderReview(SIBLINGS);
        const held = heldRebind();

        rebind.mockReturnValue(held.answer);
        open();
        fireEvent.click(within(row(SPOON_ROW)).getByRole('button', { name: PICK.name }));
        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));
        await held.resolve(SPOON_TAKEN);

        await waitFor(() => expect(screen.queryByRole('group', { name: SPOON_ROW })).toBeNull());
        expect(within(row(CUP_ROW)).getByRole('button', { name: PICK.name })).toBeTruthy();
        expect(screen.getByText(en.ambiguousNoticeOne)).toBeTruthy();
        expect(rebind).toHaveBeenCalledTimes(1);
    });

    it('a taken pick says it saved, and focus leaves the row that went for that sentence (WCAG 2.2 SC 2.4.3)', async () => {
        const { rebind } = renderReview(SIBLINGS);
        const held = heldRebind();

        rebind.mockReturnValue(held.answer);
        open();
        const candidate = within(row(SPOON_ROW)).getByRole('button', { name: PICK.name });

        candidate.focus();
        fireEvent.click(candidate);
        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));
        await held.resolve(SPOON_TAKEN);

        const saved = await screen.findByText(en.ambiguousReviewSaved);

        expect(saved.getAttribute('role')).toBe('status');
        await waitFor(() => expect(document.activeElement).toBe(saved));
    });

    it('when the LAST ambiguous line is taken, the review keeps its saved sentence, with focus on it', async () => {
        const { rebind } = renderReview(recipeOf([FLOUR, SPOON]));
        const held = heldRebind();

        rebind.mockReturnValue(held.answer);
        open();
        const candidate = within(row(SPOON_ROW)).getByRole('button', { name: PICK.name });

        candidate.focus();
        fireEvent.click(candidate);
        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));
        await held.resolve(recipeOf([FLOUR, SPOON_TAKEN.ingredients[2] ?? SPOON]));

        await waitFor(() => expect(screen.queryByRole('button', { name: en.ambiguousReviewToggle })).toBeNull());
        await waitFor(() => expect(document.activeElement).toBe(screen.getByText(en.ambiguousReviewSaved)));
    });

    /**
     * ⛔ A pick in flight keeps its candidate FOCUSABLE. Native `disabled` on the button the cook just pressed drops
     * focus to <body> in a real browser (WCAG 2.2 SC 2.4.3), so the control is `aria-disabled` and the CONTROLLER
     * refuses the second press — which is why the proof is the rebind staying at one call, not the attribute alone.
     * Every row is busy, not only the one pressed: every pick edits the same recipe version.
     */
    it('⛔ a pick in flight busies EVERY row’s candidates without natively disabling them, and refuses a second', async () => {
        const { rebind } = renderReview(SIBLINGS);

        rebind.mockReturnValue(heldRebind().answer);
        open();
        fireEvent.click(within(row(SPOON_ROW)).getByRole('button', { name: PICK.name }));
        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));
        const other = within(row(CUP_ROW)).getByRole('button', { name: PICK.name });

        expect(other.getAttribute('aria-disabled')).toBe('true');
        expect(other.hasAttribute('disabled')).toBe(false);

        fireEvent.click(other);
        expect(rebind).toHaveBeenCalledTimes(1);
    });

    it('⛔ a REFUSED pick surfaces on ITS row alone, retryable, and retry refreshes that row’s shortlist', async () => {
        const refetch = vi.fn();
        const { rebind } = renderReview(SIBLINGS);
        const held = heldRebind();

        useIngredientSuggestionSourceMock.mockReturnValue(searched(settledSearch().read, refetch));
        rebind.mockReturnValue(held.answer);
        open();
        fireEvent.click(within(row(SPOON_ROW)).getByRole('button', { name: PICK.name }));
        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));
        await held.reject(new Error('refused'));

        const said = (name: string): string[] =>
            within(row(name))
                .queryAllByRole('alert')
                .map((region) => region.textContent ?? '');

        await waitFor(() => expect(said(SPOON_ROW)).toContain(en.ambiguousReviewFailed));
        expect(said(CUP_ROW).every((text) => text === '')).toBe(true);
        expect(within(row(SPOON_ROW)).getByRole('button', { name: PICK.name })).toBeTruthy();
        expect(within(row(CUP_ROW)).queryByRole('button', { name: RETRY })).toBeNull();

        fireEvent.click(within(row(SPOON_ROW)).getByRole('button', { name: RETRY }));

        expect(refetch).toHaveBeenCalledTimes(1);
        expect(within(row(SPOON_ROW)).getByText(en.ambiguousReviewRefreshed)).toBeTruthy();
    });

    it('while the search runs, the row says it is finding matches', () => {
        useIngredientSuggestionSourceMock.mockReturnValue(
            searched({ kind: 'asking', answer: answerOf(), resumed: false }),
        );
        renderReview(recipeOf([CUP]));
        open();

        expect(within(row(CUP_ROW)).getByText(en.ambiguousReviewLoading).getAttribute('role')).toBe('status');
        expect(screen.queryByRole('button', { name: PICK.name })).toBeNull();
    });

    it('offers the cook’s own foods first, then the catalog’s, and a pick on one re-points the line to it', async () => {
        const { rebind } = renderReview(recipeOf([CUP]));

        rebind.mockReturnValue(heldRebind().answer);
        useIngredientSuggestionSourceMock.mockReturnValue(
            searched(ended(databaseFrame({ authored: [MINE], catalog: [PICK] }), COMPLETE_FRAME)),
        );
        open();

        const chips = within(row(CUP_ROW))
            .getAllByRole('button')
            .map((button) => button.textContent);

        expect(chips).toEqual([MINE.name, PICK.name]);

        fireEvent.click(within(row(CUP_ROW)).getByRole('button', { name: MINE.name }));
        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));
        expect(rebind).toHaveBeenCalledWith(RECIPE_ID, 0, {
            expectedVersion: 4,
            target: { kind: 'catalogFood', foodId: MINE.id },
        });
    });

    it.each([
        [
            'the catalog',
            ended(databaseFrame({ authored: [MINE], catalog: 'unavailable' }), COMPLETE_FRAME),
            form.ingredientCatalogUnavailable,
            MINE.name,
        ],
        [
            'the cook’s own foods',
            ended(databaseFrame({ authored: 'unavailable', catalog: [PICK] }), COMPLETE_FRAME),
            form.ingredientAuthoredUnavailable,
            PICK.name,
        ],
    ])(
        'when %s could not be searched, the row says so and offers what the other group found (L3)',
        (_half, read, sentence, offered) => {
            useIngredientSuggestionSourceMock.mockReturnValue(searched(read));
            renderReview(recipeOf([CUP]));
            open();

            expect(within(row(CUP_ROW)).getByText(sentence).getAttribute('role')).toBe('status');
            expect(within(row(CUP_ROW)).getByRole('button', { name: offered })).toBeTruthy();
        },
    );

    // P12 defect (b): a failed search used to say nothing and offer no retry.
    it('when every part failed, the row says so, offers no candidate, and Try again searches again', () => {
        const refetch = vi.fn();

        useIngredientSuggestionSourceMock.mockReturnValue(
            searched(
                ended(databaseFrame({ authored: 'unavailable', catalog: 'unavailable' }), COMPLETE_FRAME),
                refetch,
            ),
        );
        renderReview(recipeOf([CUP]));
        open();

        expect(within(row(CUP_ROW)).getByText(form.candidatesLoadFailed).getAttribute('role')).toBe('status');
        expect(
            within(row(CUP_ROW))
                .getAllByRole('button')
                .map((button) => button.getAttribute('aria-label')),
        ).toEqual([RETRY]);
        fireEvent.click(within(row(CUP_ROW)).getByRole('button', { name: RETRY }));
        expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('when everything answered with no food, the row says there is nothing to choose from (P12)', () => {
        useIngredientSuggestionSourceMock.mockReturnValue(
            searched(ended(databaseFrame(), sourceAnswered('usda'), COMPLETE_FRAME)),
        );
        renderReview(recipeOf([CUP]));
        open();

        expect(within(row(CUP_ROW)).getByText(form.candidatesEmpty).getAttribute('role')).toBe('status');
    });

    it('a source’s foods come after ours, under `From {source}`, and a pick on one adopts it, then re-points the line', async () => {
        const { rebind, adopt } = renderReview(recipeOf([CUP]));

        adopt.mockResolvedValue({ id: 'food_stewed' });
        rebind.mockReturnValue(heldRebind().answer);
        useIngredientSuggestionSourceMock.mockReturnValue(
            searched(
                ended(
                    databaseFrame({ catalog: [PICK] }),
                    sourceAnswered('usda', remoteItem('Apples, stewed', 'sealed.s')),
                    COMPLETE_FRAME,
                ),
            ),
        );
        open();

        const usda = await within(row(CUP_ROW)).findByRole('list', { name: 'From USDA' });
        const status = within(row(CUP_ROW)).getAllByRole('status')[0];
        expect(
            status === undefined
                ? 0
                : within(row(CUP_ROW)).getByRole('button', { name: PICK.name }).compareDocumentPosition(status) &
                      Node.DOCUMENT_POSITION_FOLLOWING,
        ).not.toBe(0);
        fireEvent.click(within(usda).getByRole('button', { name: 'Apples, stewed, from USDA' }));

        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));
        expect(adopt).toHaveBeenCalledWith('sealed.s');
        expect(rebind).toHaveBeenCalledWith(RECIPE_ID, 0, {
            expectedVersion: 4,
            target: { kind: 'catalogFood', foodId: 'food_stewed' },
        });
    });

    // V3-9: "the row shows `ingredientEntryAddingFromSource` as a caption after its chips, not live", on that row alone.
    it('while a source’s food is added, its row says so after its chips, not live, and no other row does', async () => {
        const { rebind, adopt } = renderReview(recipeOf([CUP, SPOON]));
        const rebound = heldRebind();
        let adopted: (root: { readonly id: string }) => void = () => undefined;

        adopt.mockReturnValue(
            new Promise((resolve) => {
                adopted = resolve;
            }),
        );
        rebind.mockReturnValue(rebound.answer);
        useIngredientSuggestionSourceMock.mockReturnValue(
            searched(
                ended(
                    databaseFrame({ catalog: [PICK] }),
                    sourceAnswered('usda', remoteItem('Apples, stewed', 'sealed.s')),
                    COMPLETE_FRAME,
                ),
            ),
        );
        open();
        const chip = await within(row(CUP_ROW)).findByRole('button', { name: 'Apples, stewed, from USDA' });

        expect(within(row(CUP_ROW)).queryByText('Adding from USDA')).toBeNull();
        fireEvent.click(chip);

        const caption = await within(row(CUP_ROW)).findByText('Adding from USDA');
        expect(chip.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
        expect(caption.closest('[role="status"], [role="alert"], [aria-live]')).toBeNull();
        expect(within(row(SPOON_ROW)).queryByText('Adding from USDA')).toBeNull();

        await act(async () => {
            adopted({ id: 'food_stewed' });
        });
        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));
        expect(within(row(CUP_ROW)).getByText('Adding from USDA')).toBeTruthy();

        await rebound.reject(new Error('down'));
        await waitFor(() => expect(within(row(CUP_ROW)).queryByText('Adding from USDA')).toBeNull());
    });

    // P8: "The cached answer for this text is dropped, so the list asks again."
    it('a remote food that food refused is said on its row in P8’s words, and the row asks its search again', async () => {
        const refetch = vi.fn();
        const { adopt } = renderReview(recipeOf([CUP]));

        adopt.mockRejectedValue(new RemoteFoodGoneError('gone'));
        useIngredientSuggestionSourceMock.mockReturnValue(
            searched(
                ended(
                    databaseFrame(),
                    sourceAnswered('usda', remoteItem('Apples, stewed', 'sealed.s')),
                    COMPLETE_FRAME,
                ),
                refetch,
            ),
        );
        open();
        fireEvent.click(await within(row(CUP_ROW)).findByRole('button', { name: 'Apples, stewed, from USDA' }));

        await waitFor(() =>
            expect(
                within(row(CUP_ROW))
                    .getAllByRole('alert')
                    .map((region) => region.textContent),
            ).toContain('Apples, stewed isn’t available any more. Choose another food.'),
        );
        expect(refetch).toHaveBeenCalledTimes(1);
    });

    // 4.1.2, `docs/design/v3Evaluation.md` V3-m4: the toggle says whether the review it discloses is open.
    it('the toggle exposes whether the review is open', () => {
        renderReview(recipeOf([CUP]));
        const toggle = screen.getByRole('button', { name: en.ambiguousReviewToggle });

        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        open();

        expect(screen.getByRole('button', { name: en.ambiguousReviewToggle }).getAttribute('aria-expanded')).toBe(
            'true',
        );
    });

    it('offline, the row says the search waits for a connection (P6)', () => {
        useIngredientSuggestionSourceMock.mockReturnValue(searched({ kind: 'parked' }));
        renderReview(recipeOf([CUP]));
        open();

        expect(within(row(CUP_ROW)).getByText(offlineNoticeMessages.en.readOffline).getAttribute('role')).toBe(
            'status',
        );
    });

    // Plan 002: a clone KEEPS a line bound to the original cook's private food (rewritten from "N ingredients need
    // re-matching", which stopped being true: the lines are not unbound and nothing needs re-matching).
    it.each([true, false])(
        'the CLONE banner (owner: %s) says the lines use the original cook’s private foods, and dismisses one-time',
        (viewerIsOwner) => {
            renderReview(recipeOf([], { clonePrivateFoodLineCount: 3 }), viewerIsOwner);

            const text = en.clonePrivateFoodsBannerMany.replace('{count}', '3');

            expect(screen.getByText(text)).toBeTruthy();

            fireEvent.click(screen.getByRole('button', { name: en.clonePrivateFoodsDismiss }));

            expect(screen.queryByText(text)).toBeNull();
        },
    );

    it('⛔ a banner on its own sits in no region named for a review there is nothing to do in (WCAG 2.4.6)', () => {
        renderReview(recipeOf([], { clonePrivateFoodLineCount: 1 }));

        expect(screen.queryByRole('region', { name: en.ambiguousReviewHeading })).toBeNull();
        expect(screen.getByText(en.clonePrivateFoodsBannerOne)).toBeTruthy();
    });

    it('the review is a region named for itself, beside the banner, when both are there', () => {
        renderReview(recipeOf([CUP], { clonePrivateFoodLineCount: 1 }));

        expect(screen.getByRole('region', { name: en.ambiguousReviewHeading })).toBeTruthy();
        expect(screen.getByText(en.clonePrivateFoodsBannerOne)).toBeTruthy();
    });

    it('the CLONE banner uses its singular sentence for one line — never "1 ingredients"', () => {
        renderReview(recipeOf([], { clonePrivateFoodLineCount: 1 }));

        expect(screen.getByText(en.clonePrivateFoodsBannerOne)).toBeTruthy();
    });

    it('⛔ the CLONE banner points at no control the editor does not have, and never says "re-match"', () => {
        for (const copy of [en.clonePrivateFoodsBannerOne, en.clonePrivateFoodsBannerMany]) {
            expect(copy).not.toMatch(/re-match|choose a food|when you edit/iu);
            expect(copy).toMatch(/private food/u);
        }
    });

    it('a clone that kept NOTHING private shows no banner — the ordinary clone is silent', () => {
        const { container } = renderReview(recipeOf([FLOUR], { clonePrivateFoodLineCount: 0 }));

        expect(container.innerHTML).toBe('');
    });
});

/**
 * Curated U15 (`docs/design/ingredientSpecialization.md` §S1, R24): a candidate shows its ROOT's name, and a pick binds
 * the root. The catalog search carries the one variant a query names (R16); the candidate draws no dotted line, so it
 * binds no variant it does not show.
 */
describe('AmbiguityReview (web) — a candidate carrying a variant (curated U15)', () => {
    beforeEach(() => {
        useIngredientSuggestionSourceMock.mockReturnValue(
            searched(
                ended(
                    databaseFrame({
                        catalog: [
                            {
                                id: 'food_brisket',
                                name: 'beef brisket',
                                score: 0.9,
                                variant: { id: 'fdc:169432', parts: [...BRISKET_FLAT_HALF_PARTS] },
                            },
                        ],
                    }),
                    COMPLETE_FRAME,
                ),
            ),
        );
    });

    const brisket = (name: string) =>
        makeIngredientView({
            name,
            quantity: { kind: 'exact', value: 2 },
            unit: 'lb',
            resolutionStatus: FoodResolutionStatus.AMBIGUOUS,
        });

    it('shows the root name and re-points the line to the root', async () => {
        const { rebind } = renderReview(recipeOf([brisket('brisket')]));

        rebind.mockReturnValue(heldRebind().answer);
        open();
        fireEvent.click(screen.getByRole('button', { name: 'beef brisket' }));
        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));

        expect(rebind).toHaveBeenCalledWith(RECIPE_ID, 0, {
            expectedVersion: 4,
            target: { kind: 'catalogFood', foodId: 'food_brisket' },
        });
    });

    it('finds a comma-joined label in the line’s own words (the control), and none on the candidate', () => {
        renderReview(recipeOf([brisket('flat half, separable lean and fat')]));
        open();
        const candidate = screen.getByRole('button', { name: 'beef brisket' });

        expect(commaJoinedTexts(document.body, BRISKET_FLAT_HALF_PARTS)).toEqual([
            '2 lb flat half, separable lean and fat',
        ]);
        expect(commaJoinedTexts(candidate, BRISKET_FLAT_HALF_PARTS)).toEqual([]);
    });
});
