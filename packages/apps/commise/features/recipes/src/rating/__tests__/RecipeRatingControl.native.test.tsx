/**
 * Native component tests for the two rating render components (FR-013, scenarios 6–10), split per B15 and
 * rendered via react-native-web under jsdom. Mirrors the web leaves state-for-state so the two platforms cannot
 * drift:
 *  - {@link RecipeRatingDisplay} — the READ-ONLY own-recipe variant (Sc8): aggregate + reason, NO input;
 *  - {@link RecipeRatingInput} — the interactive variant: the rate radiogroup (idle / already-selected /
 *    submitting), the ≥44×44 touch target (B10), remove (Sc10), and the honest error surfaces (Sc9).
 *
 * Same two mutation-lens assertions as web: the read-only variant renders no input, and selecting a star
 * reports its EXACT value.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { LocaleProvider } from '@commise/i18n/react';
import { computedContrast } from '@commise/test-utils';
import { palette } from '@commise/ui';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeRatingDisplay, RecipeRatingInput } from '../RecipeRatingControl.native.js';
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

describe('RecipeRatingDisplay (native) — read-only own-recipe variant (Sc8)', () => {
    it('shows the community aggregate as a labelled, read-only summary when rated', () => {
        renderDisplay({ average: 4, ratingCount: 3 });

        expect(screen.getByRole('img', { name: /out of 5/ })).toBeTruthy();
    });

    it('shows an honest "not yet rated" summary when unrated', () => {
        renderDisplay({ average: undefined, ratingCount: 0 });

        expect(screen.getByText('Not yet rated')).toBeTruthy();
        expect(screen.queryByRole('img', { name: /out of 5/ })).toBeNull();
    });

    it('renders NO interactive input, only the aggregate + a reason (mutation lens: the gate is structural)', () => {
        renderDisplay({ average: 4, ratingCount: 3 });

        expect(screen.queryByRole('radiogroup')).toBeNull();
        expect(screen.queryByRole('radio')).toBeNull();
        expect(screen.getByText('You can’t rate your own recipe.')).toBeTruthy();
    });
});

describe('RecipeRatingInput (native) — interactive variant', () => {
    it('shows the community aggregate as a labelled, read-only summary when rated', () => {
        renderInput({ average: 4.5, ratingCount: 12 });

        expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5, 12 ratings' })).toBeTruthy();
    });

    it('shows an honest "not yet rated" summary when unrated', () => {
        renderInput({ average: undefined, ratingCount: 0 });

        expect(screen.getByText('Not yet rated')).toBeTruthy();
        expect(screen.queryByRole('img', { name: /out of 5/ })).toBeNull();
    });

    it('offers a 5-option star radiogroup, each option accessibly named', () => {
        renderInput();

        expect(screen.getByRole('radiogroup', { name: 'Your rating' })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Rate 1 star' })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Rate 5 stars' })).toBeTruthy();
        expect(screen.getAllByRole('radio')).toHaveLength(5);
    });

    it('gives each star a ≥44×44 touch target (B10, WCAG 2.5.5)', () => {
        renderInput();

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
        renderInput({ onRate });

        fireEvent.click(screen.getByRole('radio', { name: 'Rate 4 stars' }));

        expect(onRate).toHaveBeenCalledWith(4);
    });

    it('marks the current selection as the checked radio (Sc7)', () => {
        renderInput({ selectedStars: 4 });

        expect(screen.getByRole('radio', { name: 'Rate 4 stars', checked: true })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Rate 2 stars', checked: false })).toBeTruthy();
    });

    it('pre-selects the viewer’s own rating AND reveals remove on load, while still showing the DISTINCT community score', () => {
        // Mirror of the web assertion: `selectedStars` (viewer's own prior rating) drives the input; `average`
        // (community mean) stays the read-only display — different numbers, never conflated.
        renderInput({ selectedStars: 2, average: 4.5, ratingCount: 12 });

        expect(screen.getByRole('radio', { name: 'Rate 2 stars', checked: true })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove my rating' })).toBeTruthy();
        expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5, 12 ratings' })).toBeTruthy();
    });

    it('re-rates to a different value, replacing (Sc7)', () => {
        const onRate = vi.fn();
        renderInput({ selectedStars: 4, onRate });

        fireEvent.click(screen.getByRole('radio', { name: 'Rate 2 stars' }));

        expect(onRate).toHaveBeenCalledWith(2);
    });

    it('offers remove once a rating is selected and reports it upward (Sc10)', () => {
        const onRemove = vi.fn();
        renderInput({ selectedStars: 3, onRemove });

        fireEvent.click(screen.getByRole('button', { name: 'Remove my rating' }));

        expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it('does not offer remove before any rating is selected', () => {
        renderInput({ selectedStars: undefined });

        expect(screen.queryByRole('button', { name: 'Remove my rating' })).toBeNull();
    });

    it('marks the control busy and disables the radios while a write is in flight', () => {
        renderInput({ selectedStars: 4, pending: true });

        expect(screen.getByText('Saving your rating…')).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Rate 2 stars' }).getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByRole('button', { name: 'Remove my rating' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('surfaces a not-available error honestly (Sc9)', () => {
        renderInput({ error: 'notAvailable' });

        expect(screen.getByText('This recipe isn’t available.')).toBeTruthy();
    });

    it('surfaces a generic error when a rating write fails', () => {
        renderInput({ error: 'generic' });

        expect(screen.getByText('We couldn’t save your rating. Please try again.')).toBeTruthy();
    });
});

describe('RecipeRatingControl (native) — text contrast (WCAG 2.1 AA)', () => {
    /**
     * The U4 pass demoted the sibling leaf's empty pips to `slate` ("a mist empty star is 1.9:1 — slate (5:1)
     * makes the empty pips legible for low vision", `RecipeCard.native.tsx`) but MISSED this leaf, so both its
     * `starEmpty` and `rateStarEmpty` styles were still `palette.mist`. An empty pip is the half of a rating
     * readout that states the SCALE — without it "two stars" cannot be told from "two out of two" — so it is
     * meaning-bearing, and it is drawn at body-text weight beside the summary. Rule stated once in the palette
     * JSDoc in `@commise/ui`'s `tokens/colors.ts`.
     *
     * Both variants sit directly on the recipe-detail screen, which paints no surface of its own, so the
     * backdrop is the app's `sand` background — the stricter of the plausible surfaces.
     */
    const SCREEN = palette.sand;

    it('draws the EMPTY community pips legibly on the screen background', () => {
        // average 2 of 5 → pips 3, 4 and 5 render EMPTY, which is what the scale is read from.
        renderDisplay({ average: 2, ratingCount: 3 });

        const pips = screen.getAllByText('★');

        expect(pips).toHaveLength(5);

        for (const [index, pip] of pips.slice(2).entries()) {
            expect(
                computedContrast(pip, { surface: SCREEN }),
                `empty community pip ${index + 3} of 5 on the sand screen background`,
            ).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('draws the EMPTY pips of the rate INPUT legibly on the screen background', () => {
        // ratingCount 0 → no community aggregate, so the only pips rendered are the rate input's own five;
        // selectedStars 2 leaves the 3rd, 4th and 5th empty.
        renderInput({ selectedStars: 2 });

        const pips = screen.getAllByText('★');

        expect(pips).toHaveLength(5);

        for (const [index, pip] of pips.slice(2).entries()) {
            expect(
                computedContrast(pip, { surface: SCREEN }),
                `empty rate-input pip ${index + 3} of 5 on the sand screen background`,
            ).toBeGreaterThanOrEqual(4.5);
        }
    });
});
