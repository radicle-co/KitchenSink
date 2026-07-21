/**
 * Native component tests for the interactive rating control (FR-013, scenarios 6–10), rendered via
 * react-native-web under jsdom. Mirrors the web leaf state-for-state — community aggregate (rated / unrated),
 * the rate radiogroup (idle / already-selected / submitting), remove (Sc10), the own-recipe gate (Sc8), and
 * the honest error surfaces (Sc9) — so the two platforms cannot drift. Same two mutation-lens assertions as
 * web: the own-recipe gate hides the input, and selecting a star reports its EXACT value.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { LocaleProvider } from '@commise/i18n/react';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeRatingControl } from '../RecipeRatingControl.native.js';
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

describe('RecipeRatingControl (native)', () => {
    it('shows the community aggregate as a labelled, read-only summary when rated', () => {
        renderControl({ average: 4.5, ratingCount: 12 });

        expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5, 12 ratings' })).toBeTruthy();
    });

    it('shows an honest "not yet rated" summary when unrated', () => {
        renderControl({ average: undefined, ratingCount: 0 });

        expect(screen.getByText('Not yet rated')).toBeTruthy();
        expect(screen.queryByRole('img', { name: /out of 5/ })).toBeNull();
    });

    it('offers a 5-option star radiogroup, each option accessibly named', () => {
        renderControl();

        expect(screen.getByRole('radiogroup', { name: 'Your rating' })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Rate 1 star' })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Rate 5 stars' })).toBeTruthy();
        expect(screen.getAllByRole('radio')).toHaveLength(5);
    });

    it('gives each star a ≥44×44 touch target (B10, WCAG 2.5.5)', () => {
        renderControl();

        // react-native-web compiles `minWidth`/`minHeight` to atomic CSS classes, so look up the class whose
        // rule sets 44px and assert every star carries it (jsdom can't compute a class-driven value inline).
        const rules = Array.from(document.styleSheets).flatMap((sheet) => {
            try {
                return Array.from(sheet.cssRules) as CSSStyleRule[];
            } catch {
                return [];
            }
        });
        const classFor = (declaration: string): string | undefined =>
            rules
                .find((rule) => (rule.cssText ?? '').replace(/\s+/g, '').includes(declaration))
                ?.selectorText.replace(/^\./, '');

        const minWidthClass = classFor('min-width:44px');
        const minHeightClass = classFor('min-height:44px');
        expect(minWidthClass).toBeTruthy();
        expect(minHeightClass).toBeTruthy();

        for (const star of screen.getAllByRole('radio')) {
            expect(star.classList.contains(minWidthClass as string)).toBe(true);
            expect(star.classList.contains(minHeightClass as string)).toBe(true);
        }
    });

    it('reports the SELECTED star value upward (mutation lens: exact value)', () => {
        const onRate = vi.fn();
        renderControl({ onRate });

        fireEvent.click(screen.getByRole('radio', { name: 'Rate 4 stars' }));

        expect(onRate).toHaveBeenCalledWith(4);
    });

    it('marks the current selection as the checked radio (Sc7)', () => {
        renderControl({ selectedStars: 4 });

        expect(screen.getByRole('radio', { name: 'Rate 4 stars', checked: true })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Rate 2 stars', checked: false })).toBeTruthy();
    });

    it('pre-selects the viewer’s own rating AND reveals remove on load, while still showing the DISTINCT community score', () => {
        // Mirror of the web assertion: `selectedStars` (viewer's own prior rating) drives the input; `average`
        // (community mean) stays the read-only display — different numbers, never conflated.
        renderControl({ selectedStars: 2, average: 4.5, ratingCount: 12 });

        expect(screen.getByRole('radio', { name: 'Rate 2 stars', checked: true })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove my rating' })).toBeTruthy();
        expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5, 12 ratings' })).toBeTruthy();
    });

    it('re-rates to a different value, replacing (Sc7)', () => {
        const onRate = vi.fn();
        renderControl({ selectedStars: 4, onRate });

        fireEvent.click(screen.getByRole('radio', { name: 'Rate 2 stars' }));

        expect(onRate).toHaveBeenCalledWith(2);
    });

    it('offers remove once a rating is selected and reports it upward (Sc10)', () => {
        const onRemove = vi.fn();
        renderControl({ selectedStars: 3, onRemove });

        fireEvent.click(screen.getByRole('button', { name: 'Remove my rating' }));

        expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it('does not offer remove before any rating is selected', () => {
        renderControl({ selectedStars: undefined });

        expect(screen.queryByRole('button', { name: 'Remove my rating' })).toBeNull();
    });

    it('marks the control busy and disables the radios while a write is in flight', () => {
        renderControl({ selectedStars: 4, pending: true });

        expect(screen.getByText('Saving your rating…')).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Rate 2 stars' }).getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByRole('button', { name: 'Remove my rating' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('surfaces a not-available error honestly (Sc9)', () => {
        renderControl({ error: 'notAvailable' });

        expect(screen.getByText('This recipe isn’t available.')).toBeTruthy();
    });

    it('surfaces a generic error when a rating write fails', () => {
        renderControl({ error: 'generic' });

        expect(screen.getByText('We couldn’t save your rating. Please try again.')).toBeTruthy();
    });

    describe('own-recipe gate (Sc8) — mutation lens', () => {
        it('renders NO rate input on the viewer’s own recipe, only the aggregate + a reason', () => {
            renderControl({ mode: 'own', average: 4, ratingCount: 3 });

            expect(screen.getByRole('img', { name: /out of 5/ })).toBeTruthy();
            expect(screen.queryByRole('radiogroup')).toBeNull();
            expect(screen.queryByRole('radio')).toBeNull();
            expect(screen.getByText('You can’t rate your own recipe.')).toBeTruthy();
        });
    });
});
