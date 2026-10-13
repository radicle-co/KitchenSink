/**
 * {@link usePrivateChoice} — what choosing "Private" does in the editor (E1; build spec §6.4 F8, §7.7 item 2). A control
 * that silently did nothing was the defect: a free-tier cook is told why, with the Premium sheet. The hazard (§6.4 F8)
 * is the profile LOADING: `canGoPrivate` is false then, and a Premium cook who taps Private early must not be sent to
 * an upsell for a plan they have. The choice waits for the profile and is decided after it settles.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { makeRecipeFormValues } from '../../__fixtures__/index.js';
import type { RecipeFormValues } from '../../form/values.js';
import { usePrivateChoice, type PrivateChoiceProfile } from '../usePrivateChoice.js';

const PUBLIC_DRAFT = makeRecipeFormValues({ visibility: RecipeVisibility.PUBLIC });

function mount(profile: PrivateChoiceProfile) {
    const onChange = vi.fn<(next: RecipeFormValues) => void>();
    const view = renderHook(
        (props: { readonly profile: PrivateChoiceProfile }) =>
            usePrivateChoice({ profile: props.profile, values: PUBLIC_DRAFT, onChange }),
        { initialProps: { profile } },
    );

    return { ...view, onChange };
}

describe('usePrivateChoice', () => {
    it('lets a Premium cook go private, with no sheet', () => {
        const { result } = mount({ status: 'settled', mayGoPrivate: true });

        expect(result.current.canGoPrivate).toBe(true);
        expect(result.current.sheet.open).toBe(false);
    });

    it('⛔ tells a free-tier cook why: choosing Private opens the Premium sheet, and the value is not changed', () => {
        const { result, onChange } = mount({ status: 'settled', mayGoPrivate: false });

        expect(result.current.canGoPrivate).toBe(false);
        act(() => {
            result.current.onPremiumRequired();
        });

        expect(result.current.sheet.open).toBe(true);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('Not now closes the sheet, and so does See Premium (the subscription surface is not built, 010)', () => {
        const { result } = mount({ status: 'settled', mayGoPrivate: false });

        act(() => result.current.onPremiumRequired());
        act(() => result.current.sheet.onOpenChange(false));
        expect(result.current.sheet.open).toBe(false);

        act(() => result.current.onPremiumRequired());
        act(() => result.current.sheet.onSeePremium());
        expect(result.current.sheet.open).toBe(false);
    });

    it('⛔ never treats a loading profile as the free tier: no sheet while it loads', () => {
        const { result } = mount({ status: 'loading' });

        act(() => result.current.onPremiumRequired());

        expect(result.current.sheet.open).toBe(false);
    });

    it('⛔ a Premium cook who chose Private while the profile loaded gets it, with no upsell, once it settles', () => {
        const { result, rerender, onChange } = mount({ status: 'loading' });

        act(() => result.current.onPremiumRequired());
        rerender({ profile: { status: 'settled', mayGoPrivate: true } });

        expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...PUBLIC_DRAFT, visibility: RecipeVisibility.PRIVATE });
        expect(result.current.sheet.open).toBe(false);
    });

    it('a free-tier cook who chose Private while the profile loaded is told once it settles', () => {
        const { result, rerender, onChange } = mount({ status: 'loading' });

        act(() => result.current.onPremiumRequired());
        rerender({ profile: { status: 'settled', mayGoPrivate: false } });

        expect(result.current.sheet.open).toBe(true);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('decides nothing when nobody chose Private while it loaded', () => {
        const { result, rerender, onChange } = mount({ status: 'loading' });

        rerender({ profile: { status: 'settled', mayGoPrivate: false } });

        expect(result.current.sheet.open).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
    });
});
