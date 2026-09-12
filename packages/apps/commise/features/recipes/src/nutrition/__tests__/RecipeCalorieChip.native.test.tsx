/**
 * Native component tests for the calorie chip (rendered via react-native-web under jsdom). Mirrors the web
 * leaf's coverage state for state — the two leaves share one model and must never drift on WHAT they say,
 * only on the primitives they say it with.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { LocaleProvider } from '@commise/i18n/react';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeCalorieChip } from '../RecipeCalorieChip.native.js';
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

describe('RecipeCalorieChip (native) — known', () => {
    it('renders a fresh, complete reading as the plain localized figure', () => {
        renderChip(reading());

        expect(screen.getByText('420 cal')).toBeTruthy();
        // Through the accessible-name COMPUTATION, mirroring the web leaf — see its file docblock.
        expect(screen.getByRole('img', { name: '420 cal' })).toBeTruthy();
        expect(screen.queryByRole('img', { name: /may be out of date/ })).toBeNull();
    });

    // Asserted on the emitted style CLASSES, not on `getComputedStyle`: react-native-web resolves a
    // `StyleSheet` entry to atomic classes and jsdom's cascade does not report `font-style` back through
    // `getComputedStyle` (it does report `color`), so a computed-style assertion here would pass a leaf that
    // renders no italic at all. The injected rule is checked directly instead.
    it('renders a STALE reading with its own accessible caveat AND a distinct visual treatment', () => {
        renderChip(reading({ freshness: 'stale' }));
        const stale = screen.getByRole('img', { name: '420 cal, may be out of date' });
        const staleClasses = new Set(stale.className.split(' '));

        expect(stale.textContent).toBe('420 cal');
        cleanup();

        renderChip(reading());
        const freshClasses = new Set(screen.getByText('420 cal').className.split(' '));
        const staleOnly = [...staleClasses].filter((name) => !freshClasses.has(name));

        // A stale figure a sighted reader cannot tell apart from a fresh one is the marking half of
        // "serve stale, MARKED" left unimplemented — so at least one visual channel must differ, and it must
        // resolve to a real declaration rather than an unstyled marker class.
        expect(staleOnly.length).toBeGreaterThan(0);
        const staleOnlyRules = [...document.styleSheets]
            .flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText))
            .filter((text) => staleOnly.some((name) => text.includes(`.${name} `)));
        expect(staleOnlyRules.join(' ')).toContain('italic');
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

    it('renders a known reading of ZERO as "0 cal", never as nothing', () => {
        const { container } = renderChip(reading({ caloriesPerServing: 0 }));

        expect(screen.getByText('0 cal')).toBeTruthy();
        expect(container.textContent).toBe('0 cal');
    });
});

describe('RecipeCalorieChip (native) — unaccounted', () => {
    it.each(['no_resolved_ingredients', 'no_nutrient_data', 'food_unavailable'] as const)(
        'renders NOTHING on a card for reason "%s" — and never a spinner',
        (reason) => {
            const { container } = renderChip({ state: 'unaccounted', reason });

            expect(container.innerHTML).toBe('');
            expect(screen.queryByText(/cal/)).toBeNull();
        },
    );
});
