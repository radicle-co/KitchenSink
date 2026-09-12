// @vitest-environment jsdom
/**
 * Component tests for the web calorie chip — EVERY member of the RESOLVED nutrition union, not just the
 * happy one. Queried by accessible name and visible text, never by test id.
 *
 * ⚠️ Every accessible-name assertion goes through `getByRole('img', { name })`, NEVER `getByLabelText`.
 * `getByLabelText` reads the ATTRIBUTE; `getByRole` with a name runs the accessible-name COMPUTATION. That
 * distinction is load-bearing here: ARIA prohibits naming a `role="generic"` element, so a bare
 * `<span aria-label>` would satisfy an attribute query while announcing nothing of the caveat.
 *
 * The chip is the terminal render of a deferred lookup, so two rules are asserted as invariants rather than
 * as styling preferences:
 *  - `unaccounted` renders NOTHING on a card (the established absent-value rule) and, above all, never a
 *    spinner: it is the answer, not the absence of one.
 *  - A `known` reading of 0 renders "0 cal". Treating 0 as absent is exactly the bug the wire union was
 *    reshaped to make unrepresentable.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { LocaleProvider } from '@commise/i18n/react';

import { RecipeCalorieChip } from '../RecipeCalorieChip.js';
import type { RecipeCalorieReading, RecipeCalorieState } from '../model.js';

afterEach(cleanup);

const reading = (over: Partial<RecipeCalorieReading> = {}): RecipeCalorieReading => ({
    state: 'known',
    caloriesPerServing: 420,
    isComplete: true,
    freshness: 'fresh',
    ...over,
});

const renderChip = (nutrition: RecipeCalorieState) =>
    render(
        <LocaleProvider locale="en">
            <RecipeCalorieChip nutrition={nutrition} />
        </LocaleProvider>,
    );

describe('RecipeCalorieChip (web) — known', () => {
    it('renders a fresh, complete reading as the plain localized figure', () => {
        renderChip(reading());

        expect(screen.getByText('420 cal')).toBeTruthy();
        // Named by the figure itself — a name that survives the accessible-name computation, not a dropped
        // attribute — and carrying no caveat, because there is nothing to caveat.
        expect(screen.getByRole('img', { name: '420 cal' })).toBeTruthy();
        expect(screen.queryByRole('img', { name: /may be out of date/ })).toBeNull();
        expect(screen.queryByRole('img', { name: /aren’t counted yet/ })).toBeNull();
    });

    it('renders a STALE reading with its own accessible caveat AND a distinct visual treatment', () => {
        const { container: staleTree } = renderChip(reading({ freshness: 'stale' }));
        const stale = screen.getByRole('img', { name: '420 cal, may be out of date' });

        expect(stale.textContent).toBe('420 cal');
        cleanup();

        renderChip(reading());
        const fresh = screen.getByText('420 cal');

        // The reader is being told the number may have moved, so the two must not look alike either.
        expect(stale.className).not.toBe(fresh.className);
        expect(staleTree).toBeTruthy();
    });

    it('renders an INCOMPLETE reading as an approximation, in the text and in the name', () => {
        renderChip(reading({ isComplete: false }));

        expect(screen.getByText('~420 cal')).toBeTruthy();
        expect(screen.getByRole('img', { name: 'About 420 cal, some items aren’t counted yet' })).toBeTruthy();
    });

    it('renders a reading that is BOTH stale and incomplete with the combined caveat', () => {
        renderChip(reading({ isComplete: false, freshness: 'stale' }));

        expect(screen.getByText('~420 cal')).toBeTruthy();
        expect(
            screen.getByRole('img', {
                name: 'About 420 cal, some items aren’t counted yet and may be out of date',
            }),
        ).toBeTruthy();
    });

    // Water and black coffee genuinely have zero energy. The invariant lives in the STATE (an outage lands in
    // `unaccounted`), so a zero that reaches `known` is a measured fact and MUST be rendered.
    it('renders a known reading of ZERO as "0 cal", never as nothing', () => {
        const { container } = renderChip(reading({ caloriesPerServing: 0 }));

        expect(screen.getByText('0 cal')).toBeTruthy();
        expect(container.textContent).toBe('0 cal');
    });
});

describe('RecipeCalorieChip (web) — unaccounted', () => {
    it.each(['no_resolved_ingredients', 'no_nutrient_data', 'food_unavailable'] as const)(
        'renders NOTHING on a card for reason "%s" — and never a spinner',
        (reason) => {
            const { container } = renderChip({ state: 'unaccounted', reason });

            expect(container.innerHTML).toBe('');
            expect(screen.queryByRole('status')).toBeNull();
            expect(screen.queryByText(/cal/)).toBeNull();
        },
    );
});
