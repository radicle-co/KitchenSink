// @vitest-environment jsdom
/**
 * ⛔ THE HOST WIRING TEST (web Home): the recipe widget slot starts ONE deferred calorie batch for the recent
 * recipes it is about to paint, and mounts a `RecipeNutritionSlot` per card — in every state (ADR-0021 §6).
 * The mirror of `mobile/tests/screens/screenNutrition.native.test.tsx`'s `RecipeWidgetSlot` cases, so the two
 * Home widgets cannot drift apart on the one surface where they already had (§14: mobile showed calories on
 * Home and web showed none).
 *
 * What only the HOST can get wrong, and what each case pins:
 *
 *  1. **The lookup needs the ids SYNCHRONOUSLY; the slot only has a PROMISE.** The widget leaf is pure
 *     `props → JSX` and must stay ignorant of promises, batches and `QueryClient`s, so the slot resolves the
 *     recipes itself (an inner container under its own `<Suspense>`) and hands the widget a render prop. A
 *     "fix" that moved the hook into the leaf would pass a chip assertion and break every harness that
 *     renders that leaf without a query provider.
 *  2. **N requests instead of one.** One promise per card renders identically and issues four round trips.
 *  3. **Batching more than the widget SHOWS.** The widget caps at `MAX_RECENT_RECIPES`; asking about a wider
 *     page is invisible on screen and pays for answers nothing renders.
 *  4. **A skeleton that outlives its answer.** An omitted id (authorization-by-absence) and a REJECTED batch
 *     must both settle to nothing at all — never a spinner with no answer coming.
 *
 * The real `useRecipeNutritionBatches` runs here (it is not mocked): its `ensureQueryData` + promise-identity
 * contract is what makes "one request" and "no re-suspend" true, so mocking it would delete the assertions.
 *
 * ⚠️ SUSPENSE CONVENTION (`RecipeWidgetSlot.test.tsx:11-22`): resolve a Suspense with `await act(...)`, never
 * `findBy`/`waitFor` — polling wedges the retry in a Vitest worker.
 */
import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentType } from 'react';

import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { RecipeNutritionResponse } from '@kitchensink/schema-recipe';

import { renderWithRecipeClient } from '@commise/test-utils';

const { pushMock, uncoveredLookup } = vi.hoisted(() => ({
    pushMock: vi.fn(),
    uncoveredLookup: { current: false },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

/**
 * The REAL `useRecipeNutritionBatches` runs in every case here — it is what makes "one request", "no
 * re-batch" and the promise-identity claims true rather than asserted against a stub. The one thing it cannot
 * produce is its own `null` return ("no page on screen carries this recipe"), because the container derives
 * the batched page from the very list the widget paints, so every id it asks about is covered by
 * construction. That branch is still the host's guard against the worst outcome in ADR-0021 — a card mounting
 * a boundary with no promise to settle, i.e. a skeleton that never comes down — and it becomes REACHABLE the
 * day the container's cap and the widget's cap drift apart. So the real hook is always called (hook order is
 * unconditional), and one case overrides its RESULT to drive that branch.
 */
vi.mock('@commise/features-recipes/hooks', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@commise/features-recipes/hooks')>();

    return {
        ...actual,
        useRecipeNutritionBatches: (pages: readonly (readonly string[])[]) => {
            const real = actual.useRecipeNutritionBatches(pages);

            return uncoveredLookup.current ? () => null : real;
        },
    };
});

// Render the real recipe widget synchronously in place of the `next/dynamic` code-split, exactly as the
// sibling slot suite does (see its DETERMINISM note #2) — the widget, its Suspense and the slot's promise
// wiring all stay under test; only the bundler chunk-load seam is removed. Awaiting the import in the mock
// FACTORY also pre-loads the module before any render, which is what keeps a pending batch from parking the
// whole widget behind an unresolved chunk (the artifact mobile's suite documents in its `beforeAll`).
vi.mock('next/dynamic', async () => {
    const widgetModule = await import('@commise/features-recipes/widget/web');

    return { default: (): ComponentType<RecipeHomeWidgetProps> => widgetModule.default };
});

import type { Recipe } from '@kitchensink/recipe-core';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
// The REAL prop contract of the module the mock above substitutes — so a widget whose props change breaks
// this file at `tsc`, instead of the mock quietly typing itself as whatever the slot happens to pass.
import type { RecipeHomeWidgetProps } from '@commise/features-recipes/widget/web';

import { RecipeWidgetSlot } from '../RecipeWidgetSlot';

// Real UUIDs: the batch request is validated against the published zod BEFORE it leaves the client, so a
// `rec_1`-style id would be refused at the boundary rather than reaching the assertion.
const PASTA = '00000000-0000-4000-8000-00000000000a';
const ROAST = '00000000-0000-4000-8000-00000000000b';
const TACOS = '00000000-0000-4000-8000-00000000000c';
const RISOTTO = '00000000-0000-4000-8000-00000000000d';
const FIFTH = '00000000-0000-4000-8000-00000000000e';
const SIXTH = '00000000-0000-4000-8000-00000000000f';

const makeRecipe = (overrides: Partial<Recipe> = {}): Recipe => ({
    id: PASTA,
    ownerId: 'usr_1',
    title: 'Weeknight Pasta',
    description: 'A quick dinner',
    prepTimeMinutes: 10,
    cookTimeMinutes: 15,
    totalTimeMinutes: 25,
    servings: 2,
    difficulty: 'medium',
    visibility: 'private',
    status: 'published',
    sourceType: 'user_created',
    hasSubstantiveEdit: false,
    dietaryFlags: [],
    tags: ['dinner'],
    currentVersion: 1,
    averageRating: 4.5,
    ratingCount: 12,
    usesPremiumCapability: false,
    createdAt: '2026-04-18T12:00:00.000Z',
    updatedAt: '2026-04-19T09:30:00.000Z',
    ...overrides,
});

/** A `known` reading, with the macros the wire requires (a card reads only the calories). */
const known = (caloriesPerServing: number) =>
    ({
        state: 'known',
        caloriesPerServing,
        proteinG: 12,
        carbsG: 40,
        fatG: 18,
        isComplete: true,
        freshness: 'fresh',
    }) as const;

/** Pasta has a figure; the roast is a terminal `unaccounted`; nothing is said about any other recipe. */
const NUTRITION: RecipeNutritionResponse = {
    nutrition: {
        [PASTA]: known(420),
        [ROAST]: { state: 'unaccounted', reason: 'no_resolved_ingredients' },
    },
};

/** A settled response that says nothing about the recipes on screen — the "not for you" absence. */
const OMITTING: RecipeNutritionResponse = { nutrition: {} };

/**
 * A real, network-guarded client whose recent-recipes read resolves `recipes` and whose nutrition batch is
 * the spy under test. `vi.spyOn` (never a hand-built object cast to the interface) so a client rename or
 * reshape fails `tsc` here instead of passing silently.
 */
function clientWith(
    recipes: readonly Recipe[],
    nutrition: () => Promise<RecipeNutritionResponse> = async () => NUTRITION,
): { client: RecipeServiceClient; batch: ReturnType<typeof vi.spyOn> } {
    const client = createFakeRecipeServiceClient();

    vi.spyOn(client, 'listRecipes').mockResolvedValue({
        data: [...recipes],
        total: recipes.length,
        page: 1,
        pageSize: recipes.length,
        hasMore: false,
    });
    const batch = vi.spyOn(client, 'getRecipeNutrition').mockImplementation(nutrition);

    return { client, batch };
}

/**
 * Render and settle, deterministically. FOUR things happen in sequence — the recipes promise resolves, React
 * commits the slot's inner container, that container derives the ids and starts the batch, and each card's
 * Suspense retries — and each step queues its successor. One macrotask drain covers them on an idle machine
 * and NOT under a loaded parallel run, which is how this shows up as an order-dependent failure rather than a
 * real one. So drain a small fixed number of times: still no DOM POLLING, just enough turns for a chain whose
 * length is known.
 */
const SETTLE_ROUNDS = 4;

const settle = async (): Promise<void> => {
    for (let round = 0; round < SETTLE_ROUNDS; round += 1) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }
};

const renderSlot = async (client: RecipeServiceClient) => {
    let result!: ReturnType<typeof renderWithRecipeClient>;

    await act(async () => {
        result = renderWithRecipeClient(<RecipeWidgetSlot />, client);
    });
    await settle();

    return result;
};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

beforeEach(() => {
    uncoveredLookup.current = false;
    // React logs the caught render error from the rejected-batch case.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('RecipeWidgetSlot (web) — the deferred calorie lookup', () => {
    it('issues ONE batch request covering the recent recipes, not one per card', async () => {
        const { client, batch } = clientWith([
            makeRecipe({ id: PASTA, title: 'Weeknight Pasta' }),
            makeRecipe({ id: ROAST, title: 'Sunday Roast' }),
        ]);

        await renderSlot(client);

        expect(batch, 'a widget of N cards is ONE read').toHaveBeenCalledTimes(1);
        expect(batch.mock.calls[0]?.[0], 'the request covers the recipes the widget paints').toStrictEqual([
            PASTA,
            ROAST,
        ]);
    });

    // ⛔ The widget caps its grid at MAX_RECENT_RECIPES; the request must cap with it. Asking about recipes
    // the widget never paints is invisible on screen — every other case here passes — and buys answers
    // nothing renders, on an endpoint whose cost is its id count.
    it('batches only the recipes the widget SHOWS when the page carries more', async () => {
        const { client, batch } = clientWith([
            makeRecipe({ id: PASTA, title: 'Weeknight Pasta' }),
            makeRecipe({ id: ROAST, title: 'Sunday Roast' }),
            makeRecipe({ id: TACOS, title: 'Fish Tacos' }),
            makeRecipe({ id: RISOTTO, title: 'Herb Risotto' }),
            makeRecipe({ id: FIFTH, title: 'Fifth Recipe' }),
            makeRecipe({ id: SIXTH, title: 'Sixth Recipe' }),
        ]);

        await renderSlot(client);

        expect(screen.queryByRole('button', { name: 'Fifth Recipe' }), 'the 5th card really is not shown').toBeNull();
        expect(batch.mock.calls[0]?.[0]).toStrictEqual([PASTA, ROAST, TACOS, RISOTTO]);
    });

    it('shows a calorie SKELETON on every card while the batch is in flight', async () => {
        const { client } = clientWith(
            [makeRecipe({ id: PASTA, title: 'Weeknight Pasta' }), makeRecipe({ id: ROAST, title: 'Sunday Roast' })],
            () => new Promise<RecipeNutritionResponse>(() => undefined),
        );

        await renderSlot(client);

        // The cards are already painted — the figure is deferred, the CARD is not.
        expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeInTheDocument();
        expect(screen.getAllByText('Loading calories')).toHaveLength(2);
    });

    it('shows the CHIP on the card that has a figure, and NOTHING on the one that does not', async () => {
        const { client } = clientWith([
            makeRecipe({ id: PASTA, title: 'Weeknight Pasta' }),
            makeRecipe({ id: ROAST, title: 'Sunday Roast' }),
        ]);

        await renderSlot(client);

        expect(screen.getByRole('img', { name: '420 cal' })).toBeInTheDocument();
        // `unaccounted` is a terminal answer with no figure — the card's absent-value rule, never a spinner.
        expect(screen.queryAllByText('Loading calories')).toHaveLength(0);
        expect(screen.queryAllByRole('img', { name: /cal/u })).toHaveLength(1);
    });

    it('shows NOTHING, and no lingering skeleton, when the batch OMITS the recipe', async () => {
        const { client } = clientWith([makeRecipe({ id: PASTA, title: 'Weeknight Pasta' })], async () => OMITTING);

        await renderSlot(client);

        // Authorization is by ABSENCE (ADR-0021 §3): a missing key is a definite terminal decision to render
        // nothing — never `undefined` falling through and leaving the skeleton up forever.
        expect(screen.queryByText('Loading calories')).toBeNull();
        expect(screen.queryByRole('img', { name: /cal/u })).toBeNull();
        expect(screen.getByRole('button', { name: 'Weeknight Pasta' }), 'the card itself survives').toBeInTheDocument();
    });

    // ⛔ THE INVARIANT, end to end. Note the FAKE TIMERS: the read seam sets `retry: 1` (its own option, which
    // a test `QueryClient`'s `retry: false` default does NOT override), so a failed batch is retried behind
    // TanStack's ~1s backoff before it settles. Draining that with a real wait would be a one-second test; not
    // draining it at all would assert the skeleton is gone at a moment when it legitimately is not, and then
    // "pass" for the wrong reason the day the retry is removed.
    it('renders the card WITHOUT a figure or a spinner once a REJECTED batch has exhausted its retry', async () => {
        vi.useFakeTimers();

        try {
            const { client, batch } = clientWith([makeRecipe({ id: PASTA, title: 'Weeknight Pasta' })], async () => {
                throw new Error('food service unavailable');
            });

            // ⚠️ The RENDER is inside an ASYNC `act`, and that is not decoration. RTL's own internal `act` is
            // synchronous, which commits the first paint but never gives the container's `use(recipesPromise)`
            // a turn to resolve — so the slot stays on its loading card, nothing derives ids, and the batch is
            // never called at all. Measured: this case failed as "expected 2 calls, got 0" while the true
            // state was "the widget has not asked yet". The same applies to `renderSlot` above.
            await act(async () => {
                renderWithRecipeClient(<RecipeWidgetSlot />, client);
            });
            // Now drain TanStack's retry backoff — a real ~1s timer, which is what the fake clock is for.
            await act(async () => {
                await vi.advanceTimersByTimeAsync(5_000);
            });

            expect(batch, 'the batch was attempted, then retried once').toHaveBeenCalledTimes(2);
            expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeInTheDocument();
            expect(screen.queryByText('Loading calories'), 'a failed batch must not leave a spinner').toBeNull();
            expect(screen.queryByRole('img', { name: /cal/u })).toBeNull();
            // The failure is confined to the FIGURE: the viewer's route off Home is a sibling of the widget's
            // boundary, and a nutrition failure must never reach it.
            expect(screen.getByRole('link', { name: 'See all recipes' })).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    // ⛔ THE PERMANENT-SKELETON GUARD. `null` from the lookup means "no batch covers this recipe" — we never
    // asked — and the host must turn that into a definite decision to render NOTHING. The two tempting
    // "simplifications" both produce the failure ADR-0021 is built to make unrepresentable: a non-null
    // assertion crashes the card, and substituting a stand-in promise mounts a boundary with nothing to
    // settle, so the shimmer runs for the lifetime of the page with no request in flight to end it.
    it('renders no nutrition node at all — and no spinner — when no batch covers the recipe', async () => {
        uncoveredLookup.current = true;
        const { client } = clientWith([makeRecipe({ id: PASTA, title: 'Weeknight Pasta' })]);

        await renderSlot(client);

        expect(screen.getByRole('button', { name: 'Weeknight Pasta' }), 'the card still renders').toBeInTheDocument();
        expect(screen.queryByText('Loading calories'), 'an unasked question is not a pending one').toBeNull();
        expect(screen.queryByRole('img', { name: /cal/u })).toBeNull();
    });

    it('asks for nothing at all when the viewer has no recipes', async () => {
        const { client, batch } = clientWith([]);

        await renderSlot(client);

        expect(screen.getByText('No recipes yet. Create your first recipe to see it here.')).toBeInTheDocument();
        expect(batch, 'an empty batch is a guaranteed 400 — it must never be sent').not.toHaveBeenCalled();
    });

    // ⛔ Promise IDENTITY, observed through the DOM. `use()` memoizes per promise and the card's error
    // boundary keys its reset on that same identity, so a host that hands down a promise rebuilt per render
    // re-suspends every settled chip on every re-render — a grid that blinks back to skeletons while the data
    // never changed. Nothing about the markup of the FIRST render can reveal that; only a second one can.
    it('does not re-suspend a settled chip — or re-batch — when the host re-renders', async () => {
        const { client, batch } = clientWith([makeRecipe({ id: PASTA, title: 'Weeknight Pasta' })]);

        const { rerender } = await renderSlot(client);
        expect(screen.getByRole('img', { name: '420 cal' })).toBeInTheDocument();

        // ⚠️ SYNCHRONOUS, and asserted with NOTHING flushed afterwards. An `await act(async () => rerender())`
        // cannot see this defect at all: an unstable promise re-suspends and then re-settles INSIDE the act
        // window, so the DOM is whole again by the time the assertion runs and the blink the viewer would
        // actually see leaves no trace. Measured — that version of this test passed against a host whose
        // `recipesPromise` had lost its `useMemo`. Observing the commit React makes for the re-render itself
        // is what makes "did not re-suspend" a real claim.
        act(() => {
            rerender(<RecipeWidgetSlot />);
        });

        expect(screen.getByRole('img', { name: '420 cal' }), 'the figure survived the re-render').toBeInTheDocument();
        expect(screen.queryByText('Loading calories'), 'and did not blink back to its skeleton').toBeNull();
        expect(
            screen.getByRole('button', { name: 'Weeknight Pasta' }),
            'and neither did the card around it',
        ).toBeInTheDocument();
        expect(batch, 'a re-render is not a new read').toHaveBeenCalledTimes(1);
    });
});
