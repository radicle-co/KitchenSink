/**
 * Component tests for the NATIVE per-card nutrition SLOT — the twin of `RecipeNutritionSlot.test.tsx`, run against the
 * `.native.tsx` leaves (chip and skeleton) through react-native-web. The slot itself is one shared component; the tree it
 * renders is a different leaf per platform, and "no skeleton outlives its request" is a claim about that tree.
 *
 * Native specifics, each a platform fact: the skeleton has no live region, so it is found by its accessibility NAME
 * (`getByLabelText`); the chip announces through `accessibilityRole="image"`, which react-native-web projects to
 * `role="img"`.
 *
 * REWRITTEN for ADR-0079. The slot no longer suspends: it is handed the page's batch READING (`pending`, `failed` or
 * `settled`) as a value and switches over it. So every state is rendered synchronously here, with no Suspense and no
 * `act` flushing, and each test names the reading it hands in.
 *
 * The load-bearing cases are the OMITTED recipe (a settled batch that says nothing about this recipe renders nothing —
 * never a skeleton that outlives its request, and never the `food_unavailable` lie) and the RECOVERY case (a failed
 * reading is not a latch: the next reading the host hands in is the one rendered).
 *
 * What a reading MEANS — that a query with data stays `settled` through a failed refetch, and that a background refetch
 * is not `pending` — is the hook's mapping, and it is pinned where it is made:
 * `hooks/__tests__/useRecipeNutritionBatches.test.tsx`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

import { LocaleProvider } from '@commise/i18n/react';
import type { RecipeNutritionResponse } from '@kitchensink/schema-recipe';

import { RecipeNutritionSlot } from '../RecipeNutritionSlot.js';
import type { RecipeNutritionBatchReading } from '../model.js';

afterEach(cleanup);

const PRESENT = '00000000-0000-4000-8000-00000000000a';
const OTHER = '00000000-0000-4000-8000-00000000000c';
const OMITTED = '00000000-0000-4000-8000-00000000000b';

const RESPONSE: RecipeNutritionResponse = {
    nutrition: {
        [PRESENT]: {
            state: 'known',
            caloriesPerServing: 420,
            proteinG: 12,
            carbsG: 70,
            fatG: 2,
            isComplete: true,
            freshness: 'fresh',
        },
        [OTHER]: {
            state: 'known',
            caloriesPerServing: 615,
            proteinG: 30,
            carbsG: 40,
            fatG: 20,
            isComplete: true,
            freshness: 'fresh',
        },
    },
};

const PENDING: RecipeNutritionBatchReading = { status: 'pending' };
const FAILED: RecipeNutritionBatchReading = { status: 'failed' };
const settled = (response: RecipeNutritionResponse): RecipeNutritionBatchReading => ({ status: 'settled', response });

/** One slot beside a sentinel, so "renders nothing" can be told apart from "the tree crashed". */
const slot = (reading: RecipeNutritionBatchReading, recipeId: string): ReactElement => (
    <LocaleProvider locale="en">
        <>
            <span>sentinel</span>
            <RecipeNutritionSlot reading={reading} recipeId={recipeId} />
        </>
    </LocaleProvider>
);

/** Nothing about calories is on screen: no figure, and no skeleton left running. */
function expectNoFigureAndNoSkeleton(): void {
    expect(screen.queryByLabelText('Loading calories'), 'no skeleton outlives a settled reading').toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText(/cal/u)).toBeNull();
    expect(screen.getByText('sentinel')).toBeTruthy();
}

describe('RecipeNutritionSlot (native)', () => {
    it('renders the skeleton while the batch is PENDING, and no figure', () => {
        render(slot(PENDING, PRESENT));

        expect(screen.getByLabelText('Loading calories')).toBeTruthy();
        expect(screen.queryByText(/cal$/u)).toBeNull();
    });

    it('renders THIS recipe’s chip once the batch is SETTLED with a figure for it', () => {
        render(slot(settled(RESPONSE), PRESENT));

        expect(screen.getByRole('img', { name: '420 cal' })).toBeTruthy();
        expect(screen.queryByLabelText('Loading calories')).toBeNull();
    });

    it('selects by recipe id — a sibling’s figure is never rendered in this slot', () => {
        // Guards the mutation "index the map by the first key" / "ignore `recipeId`": both would still show a
        // plausible figure, and both would be wrong on every card but one.
        render(slot(settled(RESPONSE), OTHER));

        expect(screen.getByRole('img', { name: '615 cal' })).toBeTruthy();
        expect(screen.queryByText('420 cal')).toBeNull();
    });

    // ⛔ THE OWNER RULING (2026-08-16). A recipe the settled response OMITTED is neither `known` nor `unaccounted`:
    // the batch says nothing about it, so the slot renders NOTHING — and above all not a skeleton.
    it('renders NOTHING for a recipe the SETTLED batch omitted', () => {
        render(slot(settled(RESPONSE), OMITTED));

        expectNoFigureAndNoSkeleton();
    });

    it('renders an UNACCOUNTED entry as nothing at all — the card’s absent-value rule', () => {
        render(
            slot(settled({ nutrition: { [PRESENT]: { state: 'unaccounted', reason: 'no_nutrient_data' } } }), PRESENT),
        );

        expectNoFigureAndNoSkeleton();
    });

    // ⛔ THE INVARIANT. A failed batch is a terminal answer (`unaccounted{food_unavailable}`), so the skeleton must be
    // GONE — a skeleton that survives its own request is a spinner rendering forever, on every card of the page at once.
    it('renders a FAILED batch as the terminal unavailable answer — no figure and no skeleton', () => {
        render(slot(FAILED, PRESENT));

        expectNoFigureAndNoSkeleton();
    });

    // ⛔ THE OTHER HALF. A failure that outlives its request is the same defect wearing the other mask. The slot holds
    // no state, so the reading the host hands in next is the one rendered.
    it('RECOVERS when a later reading settles: a failed reading is not a latch', () => {
        const view = render(slot(FAILED, PRESENT));
        expect(screen.queryByText(/cal/u), 'the failed batch renders no figure').toBeNull();

        view.rerender(slot(settled(RESPONSE), PRESENT));

        expect(screen.getByRole('img', { name: '420 cal' })).toBeTruthy();
        expect(screen.queryByLabelText('Loading calories')).toBeNull();
    });

    it('replaces the skeleton with the chip when the same slot’s reading goes from PENDING to SETTLED', () => {
        const view = render(slot(PENDING, PRESENT));
        expect(screen.getByLabelText('Loading calories')).toBeTruthy();

        view.rerender(slot(settled(RESPONSE), PRESENT));

        expect(screen.getByRole('img', { name: '420 cal' })).toBeTruthy();
        expect(screen.queryByLabelText('Loading calories')).toBeNull();
    });
});
