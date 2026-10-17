/**
 * {@link useGatedPrivate} — asking for Private, for every surface that offers it (the editor's visibility field, the
 * recipe page's ⋯ menu). It applies, opens the Premium sheet, or does nothing, as `privateChoice` decides
 * (owner ruling 2026-10-13; plan 2026-10-14-009 D14).
 *
 * REWRITTEN 2026-10-14: it used to WAIT on a loading profile and decide once it settled. Loading now fails closed — no
 * surface offers Private while the paid-feature state is unknown (UX spec in the plan), so a request made then does
 * nothing, and the waiting branch is gone. The sheet opens only under `upsell`, and closes if the state leaves it.
 */
import type { PaidFeatureState } from '@commise/features-account';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useGatedPrivate } from '../useGatedPrivate.js';

function mount(state: PaidFeatureState, saved: RecipeVisibility = RecipeVisibility.PUBLIC) {
    const apply = vi.fn<() => void>();
    const view = renderHook(
        (props: { readonly state: PaidFeatureState }) => useGatedPrivate({ state: props.state, saved, apply }),
        { initialProps: { state } },
    );

    return { ...view, apply };
}

describe('useGatedPrivate', () => {
    it('applies Private at once for a granted cook, with no sheet', () => {
        const { result, apply } = mount('granted');

        act(() => result.current.request());

        expect(apply).toHaveBeenCalledTimes(1);
        expect(result.current.sheet.open).toBe(false);
    });

    it('⛔ opens the Premium sheet under upsell and applies nothing', () => {
        const { result, apply } = mount('upsell');

        act(() => result.current.request());

        expect(result.current.sheet.open).toBe(true);
        expect(apply).not.toHaveBeenCalled();
    });

    it.each(['hidden', 'loading'] as const)('⛔ under %s neither applies nor opens a sheet', (state) => {
        const { result, apply } = mount(state);

        act(() => result.current.request());

        expect(result.current.sheet.open).toBe(false);
        expect(apply).not.toHaveBeenCalled();
    });

    it.each(['hidden', 'loading', 'upsell'] as const)(
        're-applies Private to a saved-private thing under %s',
        (state) => {
            const { result, apply } = mount(state, RecipeVisibility.PRIVATE);

            act(() => result.current.request());

            expect(apply).toHaveBeenCalledTimes(1);
            expect(result.current.sheet.open).toBe(false);
        },
    );

    it('Not now and See Premium both close the sheet (the subscription surface is not built, 010)', () => {
        const { result } = mount('upsell');

        act(() => result.current.request());
        act(() => result.current.sheet.onOpenChange(false));
        expect(result.current.sheet.open).toBe(false);

        act(() => result.current.request());
        act(() => result.current.sheet.onSeePremium());
        expect(result.current.sheet.open).toBe(false);
    });

    /** A refetch that changes the answer while the sheet is up: an upsell for a plan the cook now has must close. */
    it('closes an open sheet when the state leaves upsell', () => {
        const { result, rerender } = mount('upsell');

        act(() => result.current.request());
        rerender({ state: 'granted' });

        expect(result.current.sheet.open).toBe(false);
    });

    it.each([
        ['loading', false],
        ['granted', true],
        ['upsell', true],
        ['hidden', false],
    ] as const)('offers Private for a public thing under %s: %s', (state, offers) => {
        expect(mount(state).result.current.offersPrivate).toBe(offers);
    });
});
