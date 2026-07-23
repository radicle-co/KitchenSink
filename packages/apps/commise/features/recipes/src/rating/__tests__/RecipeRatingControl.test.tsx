// @vitest-environment jsdom
/**
 * Component tests for the two web rating render components (FR-013, scenarios 6–10), split per B15:
 *  - {@link RecipeRatingDisplay} — the READ-ONLY variant (own recipe, Sc8): community aggregate + reason, and
 *    NO interactive input (the mutation lens — a Display that rendered a radio would fail here);
 *  - {@link RecipeRatingInput} — the interactive variant: the rate radiogroup (idle / already-selected /
 *    submitting), the remove affordance (Sc10), and the honest error surfaces (Sc9 not-available + generic).
 *
 * Asserted on visible text and accessible roles/names only, never on CSS. The id/value wiring is the second
 * mutation lens: selecting a star calls `onRate` with EXACTLY that star count (an off-by-one or index-for-value
 * control fails). Which component the container mounts for an owner vs a rater is asserted where that decision
 * lives — `ratingModeFor` (model.test.ts) + the detail containers' tests.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { LocaleProvider } from '@commise/i18n/react';

import { RecipeRatingDisplay, RecipeRatingInput } from '../RecipeRatingControl.js';
import type { RecipeRatingDisplayProps, RecipeRatingInputProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderDisplay(overrides: Partial<RecipeRatingDisplayProps> = {}) {
    const props: RecipeRatingDisplayProps = { ratingCount: 0, ...overrides };
    render(
        <LocaleProvider locale="en">
            <RecipeRatingDisplay {...props} />
        </LocaleProvider>,
    );

    return props;
}

function renderInput(overrides: Partial<RecipeRatingInputProps> = {}) {
    const props: RecipeRatingInputProps = {
        ratingCount: 0,
        onRate: noop,
        onRemove: noop,
        ...overrides,
    };
    render(
        <LocaleProvider locale="en">
            <RecipeRatingInput {...props} />
        </LocaleProvider>,
    );

    return props;
}

describe('RecipeRatingDisplay (web) — read-only own-recipe variant (Sc8)', () => {
    it('shows the community aggregate as a labelled, read-only summary when the recipe is rated', () => {
        renderDisplay({ average: 4, ratingCount: 3 });

        expect(screen.getByRole('img', { name: /out of 5/ })).toBeTruthy();
    });

    it('shows an honest "not yet rated" summary (never a 0-star score) when unrated', () => {
        renderDisplay({ average: undefined, ratingCount: 0 });

        expect(screen.getByText('Not yet rated')).toBeTruthy();
        expect(screen.queryByRole('img', { name: /out of 5/ })).toBeNull();
    });

    it('renders NO interactive input, only the aggregate + a reason (mutation lens: the gate is structural)', () => {
        renderDisplay({ average: 4, ratingCount: 3 });

        // Dropping the gate — mounting the input variant here — would render a radiogroup and fail this test.
        expect(screen.queryByRole('radiogroup')).toBeNull();
        expect(screen.queryByRole('radio')).toBeNull();
        expect(screen.getByText('You can’t rate your own recipe.')).toBeTruthy();
    });
});

describe('RecipeRatingInput (web) — interactive variant', () => {
    it('shows the community aggregate as a labelled, read-only summary when the recipe is rated', () => {
        renderInput({ average: 4.5, ratingCount: 12 });

        expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5, 12 ratings' })).toBeTruthy();
    });

    it('shows an honest "not yet rated" summary (never a 0-star score) when unrated', () => {
        renderInput({ average: undefined, ratingCount: 0 });

        expect(screen.getByText('Not yet rated')).toBeTruthy();
        expect(screen.queryByRole('img', { name: /out of 5/ })).toBeNull();
    });

    it('offers a 5-option star radiogroup, each option accessibly named', () => {
        renderInput();

        const group = screen.getByRole('radiogroup', { name: 'Your rating' });
        expect(group).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Rate 1 star' })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Rate 5 stars' })).toBeTruthy();
        expect(screen.getAllByRole('radio')).toHaveLength(5);
    });

    it('reports the SELECTED star value upward (mutation lens: exact value, not an index)', () => {
        const onRate = vi.fn();
        renderInput({ onRate });

        fireEvent.click(screen.getByRole('radio', { name: 'Rate 4 stars' }));

        expect(onRate).toHaveBeenCalledWith(4);
    });

    it('marks the current selection as the checked radio (already-rated / change state, Sc7)', () => {
        renderInput({ selectedStars: 4 });

        expect(screen.getByRole('radio', { name: 'Rate 4 stars', checked: true })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Rate 2 stars', checked: false })).toBeTruthy();
    });

    it('pre-selects the viewer’s own rating AND reveals remove on load, while still showing the DISTINCT community score', () => {
        // FR-013 wiring: `selectedStars` (the viewer's own prior rating from the detail's `viewerRating`) drives
        // the INPUT, while `average` (the community mean) stays the read-only DISPLAY — they are different
        // numbers on purpose and must not be conflated.
        renderInput({ selectedStars: 2, average: 4.5, ratingCount: 12 });

        // The viewer's own rating is pre-selected on load…
        expect(screen.getByRole('radio', { name: 'Rate 2 stars', checked: true })).toBeTruthy();
        // …the remove affordance is revealed because they have a rating…
        expect(screen.getByRole('button', { name: 'Remove my rating' })).toBeTruthy();
        // …and the community score is shown independently (still 4.5, not the viewer's 2).
        expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5, 12 ratings' })).toBeTruthy();
    });

    it('lets the viewer re-rate to a different value, replacing (Sc7)', () => {
        const onRate = vi.fn();
        renderInput({ selectedStars: 4, onRate });

        fireEvent.click(screen.getByRole('radio', { name: 'Rate 2 stars' }));

        expect(onRate).toHaveBeenCalledWith(2);
    });

    it('offers a remove affordance once a rating is selected, and reports it upward (Sc10)', () => {
        const onRemove = vi.fn();
        renderInput({ selectedStars: 3, onRemove });

        const remove = screen.getByRole('button', { name: 'Remove my rating' });
        fireEvent.click(remove);

        expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it('does not offer a remove affordance before any rating is selected', () => {
        renderInput({ selectedStars: undefined });

        expect(screen.queryByRole('button', { name: 'Remove my rating' })).toBeNull();
    });

    it('marks the control busy and disables the radios while a write is in flight (submitting state)', () => {
        renderInput({ selectedStars: 4, pending: true });

        expect(screen.getByRole('status', { name: 'Saving your rating…' })).toBeTruthy();
        expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Rate 2 stars' }).disabled).toBe(true);
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Remove my rating' }).disabled).toBe(true);
    });

    it('surfaces a not-available error honestly for a recipe the viewer cannot read (Sc9)', () => {
        renderInput({ error: 'notAvailable' });

        expect(screen.getByRole('alert').textContent).toBe('This recipe isn’t available.');
    });

    it('surfaces a generic error when a rating write fails', () => {
        renderInput({ error: 'generic' });

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t save your rating. Please try again.');
    });
});
