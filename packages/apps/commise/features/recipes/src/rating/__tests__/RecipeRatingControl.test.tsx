// @vitest-environment jsdom
/**
 * Component tests for the web interactive rating control (FR-013, scenarios 6–10). Asserts every state the
 * control renders — the community aggregate (rated + unrated), the rate radiogroup (idle / already-selected /
 * submitting), the remove affordance (Sc10), the own-recipe gate (Sc8), and the honest error surfaces
 * (Sc9 not-available + generic) — on visible text and accessible roles/names only, never on CSS.
 *
 * Two assertions are the mutation lens the task calls for:
 *  - the own-recipe gate: in `mode="own"` NO rate radio may render (dropping the gate would offer rating your
 *    own recipe, and this test would fail);
 *  - the id/value wiring: selecting a star calls `onRate` with EXACTLY that star count (a control that wired
 *    the wrong value — e.g. off-by-one, or index instead of value — fails here).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { LocaleProvider } from '@commise/i18n/react';

import { RecipeRatingControl } from '../RecipeRatingControl.js';
import type { RecipeRatingControlProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderControl(overrides: Partial<RecipeRatingControlProps> = {}) {
    const props: RecipeRatingControlProps = {
        mode: 'rate',
        ratingCount: 0,
        onRate: noop,
        onRemove: noop,
        ...overrides,
    };
    render(
        <LocaleProvider locale="en">
            <RecipeRatingControl {...props} />
        </LocaleProvider>,
    );

    return props;
}

describe('RecipeRatingControl (web)', () => {
    it('shows the community aggregate as a labelled, read-only summary when the recipe is rated', () => {
        renderControl({ average: 4.5, ratingCount: 12 });

        expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5, 12 ratings' })).toBeTruthy();
    });

    it('shows an honest "not yet rated" summary (never a 0-star score) when unrated', () => {
        renderControl({ average: undefined, ratingCount: 0 });

        expect(screen.getByText('Not yet rated')).toBeTruthy();
        expect(screen.queryByRole('img', { name: /out of 5/ })).toBeNull();
    });

    it('offers a 5-option star radiogroup, each option accessibly named', () => {
        renderControl();

        const group = screen.getByRole('radiogroup', { name: 'Your rating' });
        expect(group).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Rate 1 star' })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Rate 5 stars' })).toBeTruthy();
        expect(screen.getAllByRole('radio')).toHaveLength(5);
    });

    it('reports the SELECTED star value upward (mutation lens: exact value, not an index)', () => {
        const onRate = vi.fn();
        renderControl({ onRate });

        fireEvent.click(screen.getByRole('radio', { name: 'Rate 4 stars' }));

        expect(onRate).toHaveBeenCalledWith(4);
    });

    it('marks the current selection as the checked radio (already-rated / change state, Sc7)', () => {
        renderControl({ selectedStars: 4 });

        expect(screen.getByRole('radio', { name: 'Rate 4 stars', checked: true })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Rate 2 stars', checked: false })).toBeTruthy();
    });

    it('pre-selects the viewer’s own rating AND reveals remove on load, while still showing the DISTINCT community score', () => {
        // FR-013 wiring: `selectedStars` (the viewer's own prior rating from the detail's `viewerRating`) drives
        // the INPUT, while `average` (the community mean) stays the read-only DISPLAY — they are different
        // numbers on purpose and must not be conflated.
        renderControl({ selectedStars: 2, average: 4.5, ratingCount: 12 });

        // The viewer's own rating is pre-selected on load…
        expect(screen.getByRole('radio', { name: 'Rate 2 stars', checked: true })).toBeTruthy();
        // …the remove affordance is revealed because they have a rating…
        expect(screen.getByRole('button', { name: 'Remove my rating' })).toBeTruthy();
        // …and the community score is shown independently (still 4.5, not the viewer's 2).
        expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5, 12 ratings' })).toBeTruthy();
    });

    it('lets the viewer re-rate to a different value, replacing (Sc7)', () => {
        const onRate = vi.fn();
        renderControl({ selectedStars: 4, onRate });

        fireEvent.click(screen.getByRole('radio', { name: 'Rate 2 stars' }));

        expect(onRate).toHaveBeenCalledWith(2);
    });

    it('offers a remove affordance once a rating is selected, and reports it upward (Sc10)', () => {
        const onRemove = vi.fn();
        renderControl({ selectedStars: 3, onRemove });

        const remove = screen.getByRole('button', { name: 'Remove my rating' });
        fireEvent.click(remove);

        expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it('does not offer a remove affordance before any rating is selected', () => {
        renderControl({ selectedStars: undefined });

        expect(screen.queryByRole('button', { name: 'Remove my rating' })).toBeNull();
    });

    it('marks the control busy and disables the radios while a write is in flight (submitting state)', () => {
        renderControl({ selectedStars: 4, pending: true });

        expect(screen.getByRole('status', { name: 'Saving your rating…' })).toBeTruthy();
        expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Rate 2 stars' }).disabled).toBe(true);
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Remove my rating' }).disabled).toBe(true);
    });

    it('surfaces a not-available error honestly for a recipe the viewer cannot read (Sc9)', () => {
        renderControl({ error: 'notAvailable' });

        expect(screen.getByRole('alert').textContent).toBe('This recipe isn’t available.');
    });

    it('surfaces a generic error when a rating write fails', () => {
        renderControl({ error: 'generic' });

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t save your rating. Please try again.');
    });

    describe('own-recipe gate (Sc8) — mutation lens', () => {
        it('renders NO rate input on the viewer’s own recipe, only the aggregate + a reason', () => {
            renderControl({ mode: 'own', average: 4, ratingCount: 3 });

            // The community score is still shown to the owner…
            expect(screen.getByRole('img', { name: /out of 5/ })).toBeTruthy();
            // …but the interactive input is absent (dropping the gate would render it and fail this test).
            expect(screen.queryByRole('radiogroup')).toBeNull();
            expect(screen.queryByRole('radio')).toBeNull();
            expect(screen.getByText('You can’t rate your own recipe.')).toBeTruthy();
        });
    });
});
