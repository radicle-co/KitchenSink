/**
 * {@link useMakePublicConfirm} — asking for Public on a private recipe (UX SPECIFY 2026-10-15; plan 2026-10-14-009 Q5).
 * A cook who holds the paid features moves freely; a downgraded owner cannot simply make it private again, so the step
 * is confirmed first, in words that depend on why (`makePublicConsequence`). The editor and the recipe page's ⋯ menu
 * both ask through it; each says what applying Public means there.
 */
import type { PaidFeatureState } from '@commise/features-account';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useMakePublicConfirm } from '../useMakePublicConfirm.js';

function mount(state: PaidFeatureState, saved: RecipeVisibility = RecipeVisibility.PRIVATE) {
    const apply = vi.fn<(done: () => void) => void>();
    const view = renderHook(() => useMakePublicConfirm({ state, saved, apply }));

    return { ...view, apply };
}

describe('useMakePublicConfirm', () => {
    it('a granted cook goes public at once, with no dialog', () => {
        const { result, apply } = mount('granted');

        act(() => result.current.request());

        expect(apply).toHaveBeenCalledTimes(1);
        expect(result.current.dialog.open).toBe(false);
    });

    it('a recipe already public goes public at once under any state', () => {
        const { result, apply } = mount('hidden', RecipeVisibility.PUBLIC);

        act(() => result.current.request());

        expect(apply).toHaveBeenCalledTimes(1);
        expect(result.current.dialog.open).toBe(false);
    });

    it.each([
        ['hidden', 'final'],
        ['upsell', 'premium'],
        ['loading', 'unknown'],
    ] as const)('⛔ under %s, asks first, with the %s words, and applies nothing yet', (state, consequence) => {
        const { result, apply } = mount(state);

        act(() => result.current.request());

        expect(result.current.dialog.open).toBe(true);
        expect(result.current.dialog.consequence).toBe(consequence);
        expect(apply).not.toHaveBeenCalled();
        expect(result.current.confirmed).toBe(false);
    });

    it('Keep private closes the dialog and applies nothing', () => {
        const { result, apply } = mount('hidden');

        act(() => result.current.request());
        act(() => result.current.dialog.onKeep());

        expect(result.current.dialog.open).toBe(false);
        expect(apply).not.toHaveBeenCalled();
        expect(result.current.confirmed).toBe(false);
    });

    it('Make public applies, and the dialog closes once the host says it is done', () => {
        const { result, apply } = mount('upsell');

        act(() => result.current.request());
        act(() => result.current.dialog.onConfirm());

        expect(apply).toHaveBeenCalledTimes(1);
        expect(result.current.confirmed).toBe(true);
        // The recipe page keeps the dialog up while its write is in flight, and closes it on success.
        expect(result.current.dialog.open).toBe(true);

        act(() => apply.mock.calls[0]?.[0]());

        expect(result.current.dialog.open).toBe(false);
    });
});
