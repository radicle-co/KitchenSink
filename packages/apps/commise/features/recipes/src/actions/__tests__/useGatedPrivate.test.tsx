/**
 * {@link useGatedPrivate} and {@link privateNeedsPremium} — the ONE place "may this cook go private, or do we show the
 * Premium sheet?" is decided (owner 2026-10-13: every upsell will sit behind a paid-features gate and roles, added here).
 * Every surface that offers Private — the editor's visibility field, the recipe page's ⋯ menu — asks this hook.
 *
 * The hazard (§6.4 F8) is the profile LOADING: a Premium cook who taps early must not be sent to an upsell for a plan
 * they have, so a request made while it loads waits and is decided when it settles.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { privateNeedsPremium } from '../privateGate.js';
import { useGatedPrivate, type PrivateChoiceProfile } from '../useGatedPrivate.js';

describe('privateNeedsPremium', () => {
    it.each([
        { target: RecipeVisibility.PRIVATE, mayGoPrivate: false, needs: true },
        { target: RecipeVisibility.PRIVATE, mayGoPrivate: true, needs: false },
        { target: RecipeVisibility.PUBLIC, mayGoPrivate: false, needs: false },
        { target: RecipeVisibility.PUBLIC, mayGoPrivate: true, needs: false },
    ])('$target with mayGoPrivate=$mayGoPrivate needs premium: $needs', ({ target, mayGoPrivate, needs }) => {
        expect(privateNeedsPremium(target, mayGoPrivate)).toBe(needs);
    });
});

function mount(profile: PrivateChoiceProfile) {
    const apply = vi.fn<() => void>();
    const view = renderHook(
        (props: { readonly profile: PrivateChoiceProfile }) => useGatedPrivate({ ...props, apply }),
        {
            initialProps: { profile },
        },
    );

    return { ...view, apply };
}

describe('useGatedPrivate', () => {
    it('applies Private at once for a cook who may, with no sheet', () => {
        const { result, apply } = mount({ status: 'settled', mayGoPrivate: true });

        act(() => result.current.request());

        expect(apply).toHaveBeenCalledTimes(1);
        expect(result.current.sheet.open).toBe(false);
    });

    it('⛔ opens the Premium sheet for a free-tier cook and applies nothing', () => {
        const { result, apply } = mount({ status: 'settled', mayGoPrivate: false });

        act(() => result.current.request());

        expect(result.current.sheet.open).toBe(true);
        expect(apply).not.toHaveBeenCalled();
    });

    it('Not now and See Premium both close the sheet (the subscription surface is not built, 010)', () => {
        const { result } = mount({ status: 'settled', mayGoPrivate: false });

        act(() => result.current.request());
        act(() => result.current.sheet.onOpenChange(false));
        expect(result.current.sheet.open).toBe(false);

        act(() => result.current.request());
        act(() => result.current.sheet.onSeePremium());
        expect(result.current.sheet.open).toBe(false);
    });

    it('⛔ never treats a loading profile as the free tier', () => {
        const { result, apply } = mount({ status: 'loading' });

        act(() => result.current.request());

        expect(result.current.sheet.open).toBe(false);
        expect(apply).not.toHaveBeenCalled();
    });

    it('applies a request made while loading, once, when a Premium cook’s profile settles', () => {
        const { result, rerender, apply } = mount({ status: 'loading' });

        act(() => result.current.request());
        rerender({ profile: { status: 'settled', mayGoPrivate: true } });
        rerender({ profile: { status: 'settled', mayGoPrivate: true } });

        expect(apply).toHaveBeenCalledTimes(1);
        expect(result.current.sheet.open).toBe(false);
    });

    it('opens the sheet when a free-tier cook’s profile settles after a request made while loading', () => {
        const { result, rerender, apply } = mount({ status: 'loading' });

        act(() => result.current.request());
        rerender({ profile: { status: 'settled', mayGoPrivate: false } });

        expect(result.current.sheet.open).toBe(true);
        expect(apply).not.toHaveBeenCalled();
    });

    it('decides nothing when nobody asked while it loaded', () => {
        const { rerender, apply, result } = mount({ status: 'loading' });

        rerender({ profile: { status: 'settled', mayGoPrivate: false } });

        expect(result.current.sheet.open).toBe(false);
        expect(apply).not.toHaveBeenCalled();
    });

    it('exposes whether the cook may go private, false until the profile says so', () => {
        expect(mount({ status: 'loading' }).result.current.mayGoPrivate).toBe(false);
        expect(mount({ status: 'settled', mayGoPrivate: true }).result.current.mayGoPrivate).toBe(true);
    });
});
