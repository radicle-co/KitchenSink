/**
 * {@link usePrivateChoice} — what choosing "Private" does in the editor (E1; build spec §6.4, §7.7 item 2; owner ruling
 * 2026-10-13; plan 2026-10-14-009 D14).
 *
 * REWRITTEN 2026-10-14: the waiting-on-a-loading-profile cases are gone with the waiting branch. Loading fails closed —
 * the editor shows the plain "Who can see it: Public" statement for a public recipe until the state is known — so
 * there is no Private choice to remember.
 */
import type { PaidFeatureState } from '@commise/features-account';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { makeRecipeFormValues } from '../../__fixtures__/index.js';
import type { RecipeFormValues } from '../../form/values.js';
import { usePrivateChoice } from '../usePrivateChoice.js';

const PUBLIC_DRAFT = makeRecipeFormValues({ visibility: RecipeVisibility.PUBLIC });
const PRIVATE_DRAFT = makeRecipeFormValues({ visibility: RecipeVisibility.PRIVATE });

function mount(
    state: PaidFeatureState,
    saved: RecipeVisibility = RecipeVisibility.PUBLIC,
    values: RecipeFormValues = saved === RecipeVisibility.PRIVATE ? PRIVATE_DRAFT : PUBLIC_DRAFT,
) {
    const onChange = vi.fn<(next: RecipeFormValues) => void>();
    const view = renderHook(() => usePrivateChoice({ state, saved, values, onChange }));

    return { ...view, onChange };
}

describe('usePrivateChoice', () => {
    it('offers Private to a granted cook, with no sheet', () => {
        const { result } = mount('granted');

        expect(result.current.offersPrivate).toBe(true);
        expect(result.current.sheet.open).toBe(false);
    });

    it('⛔ under upsell, choosing Private opens the Premium sheet and the value is not changed', () => {
        const { result, onChange } = mount('upsell');

        act(() => result.current.onPremiumRequired());

        expect(result.current.sheet.open).toBe(true);
        expect(onChange).not.toHaveBeenCalled();
    });

    it.each(['hidden', 'loading'] as const)('⛔ under %s offers no Private and opens no sheet', (state) => {
        const { result, onChange } = mount(state);

        expect(result.current.offersPrivate).toBe(false);
        act(() => result.current.onPremiumRequired());

        expect(result.current.sheet.open).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('still offers Private for a recipe that is already private, whatever the state', () => {
        expect(mount('hidden', RecipeVisibility.PRIVATE).result.current.offersPrivate).toBe(true);
    });

    it('hands the field the state and the saved visibility it decides from', () => {
        const { result } = mount('upsell', RecipeVisibility.PRIVATE);

        expect(result.current.field).toStrictEqual({
            paidFeatures: 'upsell',
            savedVisibility: RecipeVisibility.PRIVATE,
        });
    });

    /**
     * The stuck-save defect: a downgraded owner moved a private recipe's draft to Public and then back to Private, the
     * Public write landed, and the server refused the Private one. Once the draft leaves Private the free return is
     * gone — the field decides from what the cook may still keep, not from what the server held at opening.
     */
    it('⛔ under hidden, once the draft of a private recipe is Public, Private is no longer offered', () => {
        const { result } = mount('hidden', RecipeVisibility.PRIVATE, PUBLIC_DRAFT);

        expect(result.current.offersPrivate).toBe(false);
    });

    it('⛔ under upsell, once the draft of a private recipe is Public, Private asks for Premium and changes nothing', () => {
        const { result, onChange } = mount('upsell', RecipeVisibility.PRIVATE, PUBLIC_DRAFT);

        act(() => result.current.onPremiumRequired());

        expect(result.current.sheet.open).toBe(true);
        expect(onChange).not.toHaveBeenCalled();
        expect(result.current.field.savedVisibility).toBe(RecipeVisibility.PUBLIC);
    });

    it('a granted cook still moves freely between the two', () => {
        const { result, onChange } = mount('granted', RecipeVisibility.PRIVATE, PUBLIC_DRAFT);

        act(() => result.current.onPremiumRequired());

        expect(onChange).toHaveBeenCalledWith({ ...PUBLIC_DRAFT, visibility: RecipeVisibility.PRIVATE });
    });

    it('Not now closes the sheet, and so does See Premium (the subscription surface is not built, 010)', () => {
        const { result } = mount('upsell');

        act(() => result.current.onPremiumRequired());
        act(() => result.current.sheet.onOpenChange(false));
        expect(result.current.sheet.open).toBe(false);

        act(() => result.current.onPremiumRequired());
        act(() => result.current.sheet.onSeePremium());
        expect(result.current.sheet.open).toBe(false);
    });
});
