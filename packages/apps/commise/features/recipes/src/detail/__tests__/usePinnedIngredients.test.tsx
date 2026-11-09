// @vitest-environment jsdom
/**
 * `usePinnedIngredients`: the one rule both recipe shells share for the pinned bar (owner ruling R1). The bar is shown
 * only when the card has scrolled past AND the shell says the page is eligible; the list can be open only while the bar is
 * shown, and a list left open when its bar goes away stays closed when the bar returns.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { usePinnedIngredients } from '../usePinnedIngredients.js';

type Gate = { readonly scrolledPast: boolean; readonly eligible: boolean };

const mount = (initial: Gate) => renderHook((gate: Gate) => usePinnedIngredients(gate), { initialProps: initial });

describe('usePinnedIngredients', () => {
    it('shows the bar only when the card has scrolled past and the page is eligible', () => {
        expect(mount({ scrolledPast: true, eligible: true }).result.current.shown).toBe(true);
        expect(mount({ scrolledPast: false, eligible: true }).result.current.shown).toBe(false);
        expect(mount({ scrolledPast: true, eligible: false }).result.current.shown).toBe(false);
    });

    it('is closed to begin with, and opens and closes on request while shown', () => {
        const { result } = mount({ scrolledPast: true, eligible: true });

        expect(result.current.open).toBe(false);

        act(() => result.current.onOpenChange(true));
        expect(result.current.open).toBe(true);

        act(() => result.current.onOpenChange(false));
        expect(result.current.open).toBe(false);
    });

    it('is never open while the bar is not shown, even if asked to open', () => {
        const { result } = mount({ scrolledPast: true, eligible: false });

        act(() => result.current.onOpenChange(true));

        expect(result.current.open).toBe(false);
    });

    it('stays closed when the bar returns after going away with the list open', () => {
        const { result, rerender } = mount({ scrolledPast: true, eligible: true });

        act(() => result.current.onOpenChange(true));
        expect(result.current.open).toBe(true);

        rerender({ scrolledPast: false, eligible: true });
        expect(result.current).toMatchObject({ shown: false, open: false });

        rerender({ scrolledPast: true, eligible: true });
        expect(result.current).toMatchObject({ shown: true, open: false });
    });
});
