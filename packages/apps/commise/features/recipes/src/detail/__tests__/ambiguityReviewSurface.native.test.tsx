// @vitest-environment jsdom
/**
 * U13 — the NATIVE half of the AMBIGUITY REVIEW surface, asserting the same state set as the web mirror
 * (`ambiguityReviewSurface.test.tsx`, §14): one row per ambiguous LINE, one pick re-points THAT line alone (owner
 * ruling 2026-10-02, "Fix one line at a time"), the owner gate, per-row failure, and the clone banner. The decision
 * layer is shared, so what this suite pins is that the native markup renders each state and wires each pick.
 *
 * The shortlist is mocked at its seam (`useIngredientSuggestionSource`); the pick runs for real over TanStack Query
 * and a network-guarded client whose `rebindIngredientLine` is stubbed, and the surface reads the recipe from the
 * query cache, as the detail screen does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeDataSource } from '../../dataSources/__fixtures__/makeDataSource.js';
import { QueryClient, useQuery } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';
import { headedGroup, queryHeadedGroup, renderWithRecipeClient } from '@commise/test-utils';
import { FoodResolutionStatus, type RecipeDetail } from '@kitchensink/recipe-core';
import { recipeQueries, recipeServiceKeys } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { FoodServiceClient, RemoteFoodGoneError } from '@kitchensink/food-service-client';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import type { ProgressiveFrame } from '@kitchensink/food-service-client';

import { offlineNoticeMessages } from '@commise/features-core/offline';
import { palette, tint } from '@commise/ui';

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

// react-native-web does not implement `sendAccessibilityEvent`; a cursor hand-off is asserted as the call it makes.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

import { AmbiguityReview } from '../AmbiguityReview.native.js';

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

/** SPOON after the rebind re-pointed it to `PICK`. */
const SPOON_REPOINTED = {
    ...SPOON,
    ingredientId: '00000000-0000-4000-8000-0000000000b2',
    name: PICK.name,
    foodId: PICK.id,
    resolutionStatus: FoodResolutionStatus.RESOLVED,
};

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

/** The retry's name on the apple sauce rows. */
const RETRY = en.ambiguousReviewRetryLabel.replace('{phrase}', 'apple sauce');

/** The texts of a row's assertive regions. */
const assertiveIn = (node: HTMLElement): (string | null)[] =>
    Array.from(node.querySelectorAll('[aria-live="assertive"]')).map((region) => region.textContent);

/** Whether `text` is on a polite channel (a live region) inside `scope`. */
const politeSays = (text: string, scope: HTMLElement = document.body): boolean =>
    within(scope)
        .getAllByText(text)
        .some((el) => el.getAttribute('aria-live') === 'polite');

/** The accessible names of the buttons inside `node`, in order. */
const buttonNamesIn = (node: HTMLElement): (string | null)[] =>
    within(node)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'));

/** Whether `later` comes after `earlier` in the reading order. */
const follows = (earlier: Node, later: Node): boolean =>
    (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

/** A source's food, and how the review names it and its source (`ingredientRemoteSearch`, P10). */
const STEWED = 'Apples, stewed';
const remoteCopy = recipeMessages.en.ingredientRemoteSearch;
const FROM_USDA = remoteCopy.groupHeading.replace('{source}', 'USDA');
const STEWED_CHIP = remoteCopy.hitName.replace('{name}', STEWED).replace('{source}', 'USDA');

/** Our database answered with the catalog's `PICK`, and USDA answered with `STEWED`. */
const withStewed = () =>
    searched(
        ended(
            databaseFrame({ catalog: [PICK] }),
            sourceAnswered('usda', remoteItem(STEWED, 'sealed.s')),
            COMPLETE_FRAME,
        ),
    );

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

/** Render the surface over the recipe read, as the detail screen does (see the web suite). */
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

/** The review row for one line, through its header, which says the line's own words. */
const row = (name: string): HTMLElement => headedGroup(name);

beforeEach(() => {
    useIngredientSuggestionSourceMock.mockReturnValue(settledSearch());
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('AmbiguityReview (native) — every state', () => {
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
        expect(container.innerHTML).toBe('');
    });

    it('the ENTRY counts lines (singular), and the surface stays closed until toggled', () => {
        renderReview(recipeOf([CUP]));

        expect(screen.getByText(en.ambiguousNoticeOne)).toBeTruthy();
        expect(queryHeadedGroup(CUP_ROW)).toBeNull();
        expect(useIngredientSuggestionSourceMock).not.toHaveBeenCalled();
    });

    it('the ENTRY counts LINES, so two same-named lines are two', () => {
        renderReview(SIBLINGS);

        expect(screen.getByText(en.ambiguousNoticeMany.replace('{count}', '2'))).toBeTruthy();
    });

    it('⛔ same-named lines are TWO rows, each its own line, each searching the line’s own name (gap 19)', () => {
        renderReview(SIBLINGS);
        open();

        // One header per ambiguous line, in the recipe's order; the resolved flour has none.
        expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([CUP_ROW, SPOON_ROW]);
        expect(row(CUP_ROW).contains(row(SPOON_ROW))).toBe(false);
        expect(row(SPOON_ROW).contains(row(CUP_ROW))).toBe(false);
        expect(buttonNamesIn(row(CUP_ROW))).toEqual([PICK.name]);
        expect(buttonNamesIn(row(SPOON_ROW))).toEqual([PICK.name]);
        expect(useIngredientSuggestionSourceMock).toHaveBeenCalledWith('apple sauce', true, expect.any(Function));
        expect(
            useIngredientSuggestionSourceMock.mock.calls.every(([phrase]: unknown[]) => phrase === 'apple sauce'),
        ).toBe(true);
    });

    it('⛔ ONE pick re-points ONE line: one rebind, at THAT line’s stored position and the version read', async () => {
        const { rebind } = renderReview(SIBLINGS);

        rebind.mockReturnValue(heldRebind().answer);
        open();
        fireEvent.click(within(row(SPOON_ROW)).getByRole('button', { name: PICK.name }));
        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));

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
        await held.resolve(recipeOf([FLOUR, CUP, SPOON_REPOINTED]));

        await waitFor(() => expect(queryHeadedGroup(SPOON_ROW)).toBeNull());
        expect(buttonNamesIn(row(CUP_ROW))).toEqual([PICK.name]);
        expect(screen.getByText(en.ambiguousNoticeOne)).toBeTruthy();
        expect(rebind).toHaveBeenCalledTimes(1);
    });

    // Native moves the reading cursor, not keyboard focus, and the cursor reading the sentence is how it is said once.
    it('a taken pick says it saved, and the reading cursor goes to that sentence, which reads it', async () => {
        const { rebind } = renderReview(SIBLINGS);
        const held = heldRebind();

        rebind.mockReturnValue(held.answer);
        open();
        fireEvent.click(within(row(SPOON_ROW)).getByRole('button', { name: PICK.name }));
        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));
        expect(screen.queryByText(en.ambiguousReviewSaved)).toBeNull();
        await held.resolve(recipeOf([FLOUR, CUP, SPOON_REPOINTED]));

        const saved = await screen.findByText(en.ambiguousReviewSaved);

        await waitFor(() => expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(saved, 'focus'));
        expect(saved.closest('[aria-live], [role="status"], [role="alert"]')).toBeNull();
    });

    it('when the LAST ambiguous line is taken, the review keeps its saved sentence, with the cursor on it', async () => {
        const { rebind } = renderReview(recipeOf([FLOUR, SPOON]));
        const held = heldRebind();

        rebind.mockReturnValue(held.answer);
        open();
        fireEvent.click(within(row(SPOON_ROW)).getByRole('button', { name: PICK.name }));
        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));
        await held.resolve(recipeOf([FLOUR, SPOON_REPOINTED]));

        await waitFor(() => expect(screen.queryByRole('button', { name: en.ambiguousReviewToggle })).toBeNull());
        expect(queryHeadedGroup(SPOON_ROW)).toBeNull();
        const saved = screen.getByText(en.ambiguousReviewSaved);
        await waitFor(() => expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenLastCalledWith(saved, 'focus'));
    });

    it('⛔ a pick in flight busies EVERY row’s candidates and refuses a second — each edits the same version', async () => {
        const { rebind } = renderReview(SIBLINGS);

        rebind.mockReturnValue(heldRebind().answer);
        open();
        expect(within(row(CUP_ROW)).getByRole('button', { name: PICK.name }).getAttribute('aria-disabled')).not.toBe(
            'true',
        );
        fireEvent.click(within(row(SPOON_ROW)).getByRole('button', { name: PICK.name }));
        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));

        for (const name of [CUP_ROW, SPOON_ROW]) {
            for (const candidate of within(row(name)).getAllByRole('button')) {
                expect(candidate.getAttribute('aria-disabled'), name).toBe('true');
            }
        }

        fireEvent.click(within(row(CUP_ROW)).getByRole('button', { name: PICK.name }));

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

        await waitFor(() => expect(assertiveIn(row(SPOON_ROW))).toContain(en.ambiguousReviewFailed));
        expect(assertiveIn(row(CUP_ROW)).every((said) => said === '')).toBe(true);
        expect(within(row(SPOON_ROW)).getByRole('button', { name: PICK.name }).getAttribute('aria-disabled')).not.toBe(
            'true',
        );
        expect(within(row(CUP_ROW)).queryByRole('button', { name: RETRY })).toBeNull();

        fireEvent.click(within(row(SPOON_ROW)).getByRole('button', { name: RETRY }));

        expect(refetch).toHaveBeenCalledTimes(1);
        expect(within(row(SPOON_ROW)).getByText(en.ambiguousReviewRefreshed)).toBeTruthy();
        expect(within(row(CUP_ROW)).queryByText(en.ambiguousReviewRefreshed)).toBeNull();
    });

    it('while the search runs, the row says it is finding matches, politely', () => {
        useIngredientSuggestionSourceMock.mockReturnValue(
            searched({ kind: 'asking', answer: answerOf(), resumed: false }),
        );
        renderReview(recipeOf([CUP]));
        open();

        expect(politeSays(en.ambiguousReviewLoading)).toBe(true);
        expect(screen.queryByRole('button', { name: PICK.name })).toBeNull();
    });

    it('offers the cook’s own foods first, then the catalog’s, and a pick on one re-points the line to it', async () => {
        const { rebind } = renderReview(recipeOf([CUP]));

        rebind.mockReturnValue(heldRebind().answer);
        useIngredientSuggestionSourceMock.mockReturnValue(
            searched(ended(databaseFrame({ authored: [MINE], catalog: [PICK] }), COMPLETE_FRAME)),
        );
        open();

        expect(buttonNamesIn(row(CUP_ROW))).toEqual([MINE.name, PICK.name]);

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
        'when %s could not be searched, the row says so politely and offers what the other group found (L3)',
        (_part, read, sentence, offered) => {
            useIngredientSuggestionSourceMock.mockReturnValue(searched(read));
            renderReview(recipeOf([CUP]));
            open();

            expect(politeSays(sentence, row(CUP_ROW))).toBe(true);
            expect(buttonNamesIn(row(CUP_ROW))).toEqual([offered]);
        },
    );

    // P12 defect (b): a search that failed everywhere says so, and Try again is the one thing the row offers.
    it('when every part failed, the row says so politely, offers no candidate, and Try again searches again', () => {
        const refetch = vi.fn();

        useIngredientSuggestionSourceMock.mockReturnValue(
            searched(
                ended(databaseFrame({ authored: 'unavailable', catalog: 'unavailable' }), COMPLETE_FRAME),
                refetch,
            ),
        );
        renderReview(recipeOf([CUP]));
        open();

        expect(politeSays(form.candidatesLoadFailed, row(CUP_ROW))).toBe(true);
        expect(buttonNamesIn(row(CUP_ROW))).toEqual([RETRY]);

        fireEvent.click(within(row(CUP_ROW)).getByRole('button', { name: RETRY }));

        expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('when everything answered with no food, the row says there is nothing to choose from, politely (P12)', () => {
        useIngredientSuggestionSourceMock.mockReturnValue(
            searched(ended(databaseFrame(), sourceAnswered('usda'), COMPLETE_FRAME)),
        );
        renderReview(recipeOf([CUP]));
        open();

        expect(politeSays(form.candidatesEmpty)).toBe(true);
    });

    // P10: a source's chips sit under header text naming the source, and that header names their group (N1 rule 2).
    it('a source’s foods come after ours, under a header naming it, and a pick adopts it, then re-points the line', async () => {
        const { rebind, adopt } = renderReview(recipeOf([CUP]));

        adopt.mockResolvedValue({ id: 'food_stewed' });
        rebind.mockReturnValue(heldRebind().answer);
        useIngredientSuggestionSourceMock.mockReturnValue(withStewed());
        open();

        await screen.findByRole('heading', { name: FROM_USDA });
        const usda = headedGroup(FROM_USDA);
        const ours = within(row(CUP_ROW)).getByRole('button', { name: PICK.name });

        expect(row(CUP_ROW).contains(usda)).toBe(true);
        expect(usda.contains(ours)).toBe(false);
        expect(follows(ours, usda)).toBe(true);
        expect(buttonNamesIn(usda)).toEqual([STEWED_CHIP]);

        fireEvent.click(within(usda).getByRole('button', { name: STEWED_CHIP }));
        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));

        expect(adopt).toHaveBeenCalledWith('sealed.s');
        expect(rebind).toHaveBeenCalledWith(RECIPE_ID, 0, {
            expectedVersion: 4,
            target: { kind: 'catalogFood', foodId: 'food_stewed' },
        });
    });

    // V3-9: the row shows where its food is coming from as a caption after its chips, not live, on that row alone.
    it('while a source’s food is added, its row says so after its chips, not live, and no other row does', async () => {
        const { rebind, adopt } = renderReview(recipeOf([CUP, SPOON]));
        const rebound = heldRebind();
        const adding = form.ingredientEntryAddingFromSource.replace('{source}', 'USDA');
        let adopted: (root: { readonly id: string }) => void = () => undefined;

        adopt.mockReturnValue(
            new Promise((resolve) => {
                adopted = resolve;
            }),
        );
        rebind.mockReturnValue(rebound.answer);
        useIngredientSuggestionSourceMock.mockReturnValue(withStewed());
        open();
        const chip = await within(row(CUP_ROW)).findByRole('button', { name: STEWED_CHIP });

        expect(within(row(CUP_ROW)).queryByText(adding)).toBeNull();
        fireEvent.click(chip);

        const caption = await within(row(CUP_ROW)).findByText(adding);

        for (const candidate of within(row(CUP_ROW)).getAllByRole('button')) {
            expect(follows(candidate, caption), candidate.getAttribute('aria-label') ?? '').toBe(true);
        }

        expect(caption.closest('[aria-live], [role="status"], [role="alert"]')).toBeNull();
        expect(within(row(SPOON_ROW)).queryByText(adding)).toBeNull();

        await act(async () => {
            adopted({ id: 'food_stewed' });
        });
        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));
        expect(within(row(CUP_ROW)).getByText(adding)).toBeTruthy();

        await rebound.reject(new Error('down'));
        await waitFor(() => expect(within(row(CUP_ROW)).queryByText(adding)).toBeNull());
    });

    // The spec's native target floor (WCAG 2.5.8 at 48 × 48 dp), on ours and a source's chips alike.
    it('every chip on a row is a 48 dp target, filled with the seafoam tint token', async () => {
        useIngredientSuggestionSourceMock.mockReturnValue(
            searched(
                ended(
                    databaseFrame({ authored: [MINE], catalog: [PICK] }),
                    sourceAnswered('usda', remoteItem(STEWED)),
                    COMPLETE_FRAME,
                ),
            ),
        );
        renderReview(recipeOf([CUP]));
        open();
        await within(row(CUP_ROW)).findByRole('button', { name: STEWED_CHIP });

        const chips = within(row(CUP_ROW)).getAllByRole('button');

        expect(chips.map((chip) => chip.getAttribute('aria-label'))).toEqual([MINE.name, PICK.name, STEWED_CHIP]);

        for (const chip of chips) {
            const style = window.getComputedStyle(chip);
            const name = chip.getAttribute('aria-label') ?? '';

            expect(Number.parseFloat(style.minHeight), name).toBeGreaterThanOrEqual(48);
            expect(style.backgroundColor, name).toBe(tint(palette.seafoam, 0.1));
        }
    });

    // P8: "The cached answer for this text is dropped, so the list asks again."
    it('a remote food that food refused is said on its row in P8’s words, and the row asks its search again', async () => {
        const refetch = vi.fn();
        const { adopt, rebind } = renderReview(recipeOf([CUP]));

        adopt.mockRejectedValue(new RemoteFoodGoneError('gone'));
        useIngredientSuggestionSourceMock.mockReturnValue(
            searched(
                ended(databaseFrame(), sourceAnswered('usda', remoteItem(STEWED, 'sealed.s')), COMPLETE_FRAME),
                refetch,
            ),
        );
        open();
        fireEvent.click(await within(row(CUP_ROW)).findByRole('button', { name: STEWED_CHIP }));

        await waitFor(() =>
            expect(assertiveIn(row(CUP_ROW))).toContain(form.ingredientRemotePickGone.replace('{name}', STEWED)),
        );
        expect(refetch).toHaveBeenCalledTimes(1);
        expect(rebind).not.toHaveBeenCalled();
    });

    // V3-m4, 4.1.2: the toggle says whether the review it discloses is open, as the web leaf's `aria-expanded` does.
    it('the toggle exposes whether the review is open', () => {
        renderReview(recipeOf([CUP]));
        const toggle = screen.getByRole('button', { name: en.ambiguousReviewToggle });

        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        open();

        expect(screen.getByRole('button', { name: en.ambiguousReviewToggle }).getAttribute('aria-expanded')).toBe(
            'true',
        );
    });

    it('offline, the row says the search waits for a connection, politely (P6)', () => {
        useIngredientSuggestionSourceMock.mockReturnValue(searched({ kind: 'parked' }));
        renderReview(recipeOf([CUP]));
        open();

        expect(politeSays(offlineNoticeMessages.en.readOffline)).toBe(true);
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

    it('⛔ a banner on its own carries no label naming a review there is nothing to do in (WCAG 2.4.6)', () => {
        renderReview(recipeOf([], { clonePrivateFoodLineCount: 1 }));

        expect(screen.queryByLabelText(en.ambiguousReviewHeading)).toBeNull();
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

/** Curated U15 — see the web file: the same set. */
describe('AmbiguityReview (native) — a candidate carrying a variant (curated U15)', () => {
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

/**
 * `docs/design/nativeContainerNames.md` N1, on the review's three containers. The section's name is said by its toggle,
 * so the section carries none (rule 1). A row's words are its header, so the row is no named group (rules 2 and 4).
 * A group of candidates under a header naming its source carries no name of its own (rule 2). Each name is said by one
 * node (N4).
 */
describe('AmbiguityReview (native) — N1: each name is said once', () => {
    /** One row whose search found the cook's food, a catalog food and a source's food, so a source group shows. */
    const renderOpenRowWithASourceGroup = (): void => {
        useIngredientSuggestionSourceMock.mockReturnValue(
            searched(
                ended(
                    databaseFrame({ authored: [MINE], catalog: [PICK] }),
                    sourceAnswered('usda', remoteItem('stewed apples')),
                    COMPLETE_FRAME,
                ),
            ),
        );
        renderReview(recipeOf([CUP]));
        open();
    };

    /** The review's name is labelled on one node, the toggle. */
    const namedByTheToggleAlone = (): void => {
        const named = screen.queryAllByLabelText(en.ambiguousReviewHeading);

        expect(named).toHaveLength(1);
        expect(named[0]).toBe(screen.getByRole('button', { name: en.ambiguousReviewToggle }));
    };

    it('says the review’s name through its toggle alone, closed and open', () => {
        renderReview(SIBLINGS);

        namedByTheToggleAlone();
        open();
        namedByTheToggleAlone();
    });

    it('says the review’s name through its toggle alone beside a clone banner, closed and open', () => {
        renderReview(recipeOf([CUP], { clonePrivateFoodLineCount: 2 }));

        expect(screen.getByText(en.clonePrivateFoodsBannerMany.replace('{count}', '2'))).toBeTruthy();
        namedByTheToggleAlone();
        open();
        namedByTheToggleAlone();
    });

    it('says a row’s words through its header, and labels no node with them', () => {
        renderOpenRowWithASourceGroup();

        expect(screen.getAllByRole('heading', { name: CUP_ROW })).toHaveLength(1);
        expect(screen.queryAllByLabelText(CUP_ROW)).toEqual([]);
    });

    it('says a source group’s name through its header, and labels no node with it', () => {
        renderOpenRowWithASourceGroup();

        const groupHeaders = screen.getAllByRole('heading').filter((heading) => heading.textContent !== CUP_ROW);
        expect(groupHeaders).not.toEqual([]);

        for (const header of groupHeaders) {
            expect(screen.queryAllByLabelText(header.textContent ?? ''), header.textContent ?? '').toEqual([]);
        }
    });
});
