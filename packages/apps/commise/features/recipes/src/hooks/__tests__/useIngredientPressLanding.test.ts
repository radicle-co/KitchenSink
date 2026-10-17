/**
 * The ingredient filter moves focus when the cook's add or removal LANDS, not when it is pressed (curated U9, spec
 * §S8.1a "Focus at the cap"). The web container writes the filter to the URL, so the new filter arrives a render after
 * the press. A signal that advanced on the press fired while the pressed control was still mounted, and nothing moved
 * focus once it unmounted.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useIngredientPressLanding } from '../useIngredientPressLanding.js';

describe('useIngredientPressLanding', () => {
    it('advances once when a pressed change lands in a later render', () => {
        const { result, rerender } = renderHook(({ count }) => useIngredientPressLanding(count), {
            initialProps: { count: 5 },
        });

        act(() => result.current.markPressed());
        rerender({ count: 5 });
        expect(result.current.signal).toBe(0);

        rerender({ count: 6 });
        expect(result.current.signal).toBe(1);

        rerender({ count: 6 });
        expect(result.current.signal).toBe(1);
    });

    it('advances when the press and its change land in the same render', () => {
        const { result, rerender } = renderHook(({ count }) => useIngredientPressLanding(count), {
            initialProps: { count: 2 },
        });

        act(() => {
            result.current.markPressed();
        });
        rerender({ count: 1 });

        expect(result.current.signal).toBe(1);
    });

    it('never advances for a change nobody pressed (a URL fill, back navigation)', () => {
        const { result, rerender } = renderHook(({ count }) => useIngredientPressLanding(count), {
            initialProps: { count: 0 },
        });

        rerender({ count: 6 });
        rerender({ count: 3 });

        expect(result.current.signal).toBe(0);
    });

    it('starts at zero, so mounting never moves focus', () => {
        expect(renderHook(() => useIngredientPressLanding(6)).result.current.signal).toBe(0);
    });
});
