// @vitest-environment jsdom
/**
 * Tests for the session serving-scale store and its React binding.
 *
 * The behaviours that matter, and that a naive `useState` implementation would fail: the count SURVIVES a
 * remount (a cook who doubles a recipe, opens a photo, and comes back must still be doubled — the same
 * justification `cookingProgress.ts` records), it is keyed PER RECIPE (recipe B never inherits recipe A's
 * doubling), and it always starts at the count the author created the recipe with.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MAX_SCALED_SERVINGS, MIN_SCALED_SERVINGS } from '@kitchensink/recipe-core/scaling';

import { getServings, resetServingScale, setServings, subscribe } from '../servingScale.js';
import { useServingScale } from '../useServingScale.js';

afterEach(resetServingScale);

describe('servingScale store', () => {
    it('defaults to the recipe’s own serving count when nothing was chosen', () => {
        expect(getServings('rec_1', 4)).toBe(4);
    });

    it('remembers a chosen count per recipe, without leaking across recipes', () => {
        setServings('rec_1', 4, 8);

        expect(getServings('rec_1', 4)).toBe(8);
        expect(getServings('rec_2', 2)).toBe(2);
    });

    it('clamps on the way IN, so the store can never hold an unusable count', () => {
        setServings('rec_1', 4, 10_000);
        expect(getServings('rec_1', 4)).toBe(MAX_SCALED_SERVINGS);

        setServings('rec_1', 4, -3);
        expect(getServings('rec_1', 4)).toBe(MIN_SCALED_SERVINGS);
    });

    it('lets a recipe authored above the display cap keep its own yield', () => {
        const huge = MAX_SCALED_SERVINGS + 150;

        setServings('rec_big', huge, huge);

        expect(getServings('rec_big', huge)).toBe(huge);
    });

    it('notifies subscribers and stops after unsubscribe', () => {
        const listener = vi.fn();
        const unsubscribe = subscribe(listener);

        setServings('rec_1', 4, 6);
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        setServings('rec_1', 4, 7);

        // An Observer that cannot be detached leaks the component that attached it.
        expect(listener).toHaveBeenCalledTimes(1);
    });
});

describe('useServingScale', () => {
    it('starts at the serving count the recipe was created with', () => {
        const { result } = renderHook(() => useServingScale('rec_1', 4));

        expect(result.current.servings).toBe(4);
    });

    it('adopts a chosen serving count', () => {
        const { result } = renderHook(() => useServingScale('rec_1', 4));

        act(() => result.current.setServings(8));

        expect(result.current.servings).toBe(8);
    });

    it('clamps whatever it is handed', () => {
        const { result } = renderHook(() => useServingScale('rec_1', 4));

        act(() => result.current.setServings(0));
        expect(result.current.servings).toBe(MIN_SCALED_SERVINGS);

        act(() => result.current.setServings(Number.NaN));
        expect(result.current.servings).toBe(MIN_SCALED_SERVINGS);
    });

    it('keeps the chosen count across an unmount and remount of the same recipe', () => {
        const first = renderHook(() => useServingScale('rec_1', 4));
        act(() => first.result.current.setServings(12));
        first.unmount();

        const second = renderHook(() => useServingScale('rec_1', 4));

        // This is the whole reason the state is not `useState`: navigating away and back mid-cook must not
        // silently halve the batch the cook is already making.
        expect(second.result.current.servings).toBe(12);
    });

    it('opens another recipe at ITS author’s yield, not the previous recipe’s', () => {
        const { result } = renderHook(({ id, base }) => useServingScale(id, base), {
            initialProps: { id: 'rec_1', base: 4 },
        });

        act(() => result.current.setServings(12));

        const other = renderHook(() => useServingScale('rec_2', 2));
        expect(other.result.current.servings).toBe(2);
    });

    it('re-renders every subscriber when the count changes', () => {
        const a = renderHook(() => useServingScale('rec_1', 4));
        const b = renderHook(() => useServingScale('rec_1', 4));

        act(() => a.result.current.setServings(6));

        expect(b.result.current.servings).toBe(6);
    });
});
