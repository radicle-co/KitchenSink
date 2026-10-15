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
    // The profile's own answer: the state itself once settled, nothing while loading (a failed read passes `undefined`).
    knownPaidFeatures: Exclude<PaidFeatureState, 'loading'> | undefined = state === 'loading' ? undefined : state,
) {
    const onChange = vi.fn<(next: RecipeFormValues) => void>();
    const view = renderHook(() => usePrivateChoice({ state, knownPaidFeatures, saved, values, onChange }));

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
            heldVisibility: RecipeVisibility.PRIVATE,
            privateRefusal: 'premium',
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
        expect(result.current.field.heldVisibility).toBe(RecipeVisibility.PUBLIC);
    });

    it('a granted cook still moves freely between the two', () => {
        const { result, onChange } = mount('granted', RecipeVisibility.PRIVATE, PUBLIC_DRAFT);

        act(() => result.current.onPremiumRequired());

        expect(onChange).toHaveBeenCalledWith({ ...PUBLIC_DRAFT, visibility: RecipeVisibility.PRIVATE });
    });

    // ── Q5: a downgraded owner confirms before a private recipe goes public (UX SPECIFY 2026-10-15). ────────────────────
    it.each([
        ['hidden', 'final'],
        ['upsell', 'premium'],
        ['loading', 'unknown'],
    ] as const)(
        '⛔ under %s, choosing Public on a private recipe asks first, and changes nothing yet',
        (state, consequence) => {
            const { result, onChange } = mount(state, RecipeVisibility.PRIVATE);

            act(() => result.current.onConfirmPublic());

            expect(result.current.confirm).toMatchObject({ open: true, consequence });
            expect(onChange).not.toHaveBeenCalled();
        },
    );

    it('Make public changes the draft and closes the dialog; Keep private changes nothing', () => {
        const kept = mount('hidden', RecipeVisibility.PRIVATE);

        act(() => kept.result.current.onConfirmPublic());
        act(() => kept.result.current.confirm.onKeep());

        expect(kept.result.current.confirm.open).toBe(false);
        expect(kept.onChange).not.toHaveBeenCalled();
        expect(kept.result.current.statement.focusOnMount).toBe(false);

        const confirmed = mount('hidden', RecipeVisibility.PRIVATE);

        act(() => confirmed.result.current.onConfirmPublic());
        act(() => confirmed.result.current.confirm.onConfirm());

        expect(confirmed.onChange).toHaveBeenCalledWith({ ...PRIVATE_DRAFT, visibility: RecipeVisibility.PUBLIC });
        expect(confirmed.result.current.confirm.open).toBe(false);
        // The field gives way to the statement, so the statement takes the focus the Public radio had (WCAG 2.4.3).
        expect(confirmed.result.current.statement.focusOnMount).toBe(true);
    });

    it('a granted cook goes public at once, with no dialog', () => {
        const { result, onChange } = mount('granted', RecipeVisibility.PRIVATE);

        act(() => result.current.onConfirmPublic());

        expect(onChange).toHaveBeenCalledWith({ ...PRIVATE_DRAFT, visibility: RecipeVisibility.PUBLIC });
        expect(result.current.confirm.open).toBe(false);
    });

    it.each([
        ['hidden', true],
        ['upsell', false],
        ['granted', false],
        ['loading', false],
    ] as const)(
        'a kept draft`s Private for a recipe not held private: the statement says so under %s → %s',
        (state, expected) => {
            const { result } = mount(state, RecipeVisibility.PUBLIC, PRIVATE_DRAFT);

            expect(result.current.statement.privateUnavailable).toBe(expected);
        },
    );

    /**
     * Review B1: a FAILED profile read shows as `hidden`, but it is not a known refusal. A kept draft's Private then
     * stands — it is what the create and the follow-up send — so the field shows it rather than a statement that says
     * Public.
     */
    it('⛔ after a failed profile read, a kept draft`s Private stands and is shown as chosen', () => {
        // Rendered directly: `mount`'s default would turn an explicit `undefined` back into the state.
        const { result } = renderHook(() =>
            usePrivateChoice({
                state: 'hidden',
                knownPaidFeatures: undefined,
                saved: RecipeVisibility.PUBLIC,
                values: PRIVATE_DRAFT,
                onChange: vi.fn(),
            }),
        );

        expect(result.current.offersPrivate).toBe(true);
        expect(result.current.statement.privateUnavailable).toBe(false);
        expect(result.current.field.privateRefusal).toBeUndefined();
    });

    it('under a known refusal, the field is told why a kept draft`s Private will not stand', () => {
        expect(mount('upsell', RecipeVisibility.PUBLIC, PRIVATE_DRAFT).result.current.field.privateRefusal).toBe(
            'premium',
        );
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
