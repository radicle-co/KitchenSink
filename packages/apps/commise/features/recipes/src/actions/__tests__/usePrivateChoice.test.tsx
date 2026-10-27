/**
 * {@link usePrivateChoice} - what choosing "Private" does in the editor (E1; build spec section 6.4, 7.7 item 2; owner
 * ruling 2026-10-13; plan 2026-10-14-009 D14).
 *
 * REWRITTEN for ADR-0073 and the owner ruling of 2026-10-26: public is NEVER final. A recipe is under the SLOTS rule (a
 * free cook's own, book or paid-site recipe) or the PREMIUM rule (an imported public-web recipe, where the old
 * paid-feature table still stands). The `final` and `unknown` make-public words are gone; going public from a held Private
 * says it frees a slot (slots rule) or that Pro is needed to return (premium rule, upsell only).
 *
 * UPDATED for the owner ruling of 2026-10-26 (ADR-0073 section 12): the recipe is either PUBLISHED (the cook's real
 * standing decides, as every case above) or a DRAFT, which holds no slot - its last describe block. The `mount` helper
 * defaults to a published recipe, which is what the earlier cases were always about.
 */
import type { PaidFeatureState } from '@commise/features-account';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { makeRecipeFormValues } from '../../__fixtures__/index.js';
import type { RecipeFormValues } from '../../form/values.js';
import type { PrivateRule, SlotStanding } from '../recipePrivateGate.js';
import { usePrivateChoice } from '../usePrivateChoice.js';

const PUBLIC_DRAFT = makeRecipeFormValues({ visibility: RecipeVisibility.PUBLIC });
const PRIVATE_DRAFT = makeRecipeFormValues({ visibility: RecipeVisibility.PRIVATE });
const OPEN: SlotStanding = { kind: 'open', used: 38, limit: 50, left: 12 };
const FULL: SlotStanding = { kind: 'full', used: 50, limit: 50 };

function mount(
    state: PaidFeatureState,
    saved: RecipeVisibility = RecipeVisibility.PUBLIC,
    values: RecipeFormValues = saved === RecipeVisibility.PRIVATE ? PRIVATE_DRAFT : PUBLIC_DRAFT,
    rule: PrivateRule = 'premium',
    standing: SlotStanding = { kind: 'unknown' },
    // The profile's own answer: the state itself once settled, nothing while loading (a failed read passes `undefined`).
    knownPaidFeatures: Exclude<PaidFeatureState, 'loading'> | undefined = state === 'loading' ? undefined : state,
    publication: { readonly published: boolean } = {
        published: true,
    },
) {
    const onChange = vi.fn<(next: RecipeFormValues) => void>();
    const view = renderHook(() =>
        usePrivateChoice({ state, knownPaidFeatures, rule, standing, publication, saved, values, onChange }),
    );

    return { ...view, onChange };
}

describe('usePrivateChoice - the premium rule (an imported public-web recipe)', () => {
    it('offers Private to a granted cook, with no sheet', () => {
        const { result } = mount('granted');

        expect(result.current.offersPrivate).toBe(true);
        expect(result.current.sheet.open).toBe(false);
    });

    it('⛔ under upsell, choosing Private opens the Pro sheet and the value is not changed', () => {
        const { result, onChange } = mount('upsell');

        act(() => result.current.onPremiumRequired());

        expect(result.current.sheet.open).toBe(true);
        expect(onChange).not.toHaveBeenCalled();
    });

    // REWRITTEN for the owner ruling of 2026-10-26: under `hidden` the field is still drawn, with Private REFUSED and the
    // reason as its description, instead of a statement with no Private card (the publish-time ask then never appears).
    it('⛔ under hidden shows the field (Private refused, not offered as a choice) and opens no sheet', () => {
        const { result, onChange } = mount('hidden');

        expect(result.current.offersPrivate).toBe(true);
        expect(result.current.field.privateRefusal).toBe('final');
        act(() => result.current.onPremiumRequired());

        expect(result.current.sheet.open).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('⛔ while loading offers no Private and opens no sheet', () => {
        const { result, onChange } = mount('loading');

        expect(result.current.offersPrivate).toBe(false);
        act(() => result.current.onPremiumRequired());

        expect(result.current.sheet.open).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('still offers Private for a recipe that is already private, whatever the state', () => {
        expect(mount('hidden', RecipeVisibility.PRIVATE).result.current.offersPrivate).toBe(true);
    });

    it('hands the field the facts and the saved visibility it decides from', () => {
        const { result } = mount('upsell', RecipeVisibility.PRIVATE);

        expect(result.current.field).toStrictEqual({
            facts: { rule: 'premium', standing: { kind: 'unknown' }, state: 'upsell' },
            heldVisibility: RecipeVisibility.PRIVATE,
            privateRefusal: 'premium',
        });
    });

    /**
     * The stuck-save defect: a downgraded owner moved a private recipe's draft to Public and then back to Private, the
     * Public write landed, and the server refused the Private one. Once the draft leaves Private the free return is
     * gone - the field decides from what the cook may still keep, not from what the server held at opening.
     */
    it('⛔ under hidden, once the draft of a private recipe is Public, Private is no longer a choice: the field refuses it', () => {
        const { result } = mount('hidden', RecipeVisibility.PRIVATE, PUBLIC_DRAFT);

        expect(result.current.offersPrivate).toBe(true);
        expect(result.current.field.heldVisibility).toBe(RecipeVisibility.PUBLIC);
        expect(result.current.field.privateRefusal).toBe('final');
    });

    it('⛔ under upsell, once the draft of a private recipe is Public, Private asks for Pro and changes nothing', () => {
        const { result, onChange } = mount('upsell', RecipeVisibility.PRIVATE, PUBLIC_DRAFT);

        act(() => result.current.onPremiumRequired());

        expect(result.current.sheet.open).toBe(true);
        expect(onChange).not.toHaveBeenCalled();
        expect(result.current.field.heldVisibility).toBe(RecipeVisibility.PUBLIC);
    });

    // Going public: only the upsell has a cost to state (public is never final).
    it('⛔ under the upsell, choosing Public on a private recipe asks first with the Pro words, and changes nothing yet', () => {
        const { result, onChange } = mount('upsell', RecipeVisibility.PRIVATE);

        act(() => result.current.onConfirmPublic());

        expect(result.current.confirm).toMatchObject({ open: true, consequence: 'premium' });
        expect(onChange).not.toHaveBeenCalled();
    });

    it.each(['hidden', 'loading', 'granted'] as const)(
        'under %s, choosing Public on a private recipe goes public at once - there is nothing to say',
        (state) => {
            const { result, onChange } = mount(state, RecipeVisibility.PRIVATE);

            act(() => result.current.onConfirmPublic());

            expect(onChange).toHaveBeenCalledWith({ ...PRIVATE_DRAFT, visibility: RecipeVisibility.PUBLIC });
            expect(result.current.confirm.open).toBe(false);
        },
    );

    /**
     * Review B1: a FAILED profile read shows as `hidden`, but it is not a known refusal. A kept draft's Private then
     * stands - it is what the create and the follow-up send - so the field shows it rather than a statement that says
     * Public.
     */
    it('⛔ after a failed profile read, a kept draft`s Private stands and is shown as chosen', () => {
        // Rendered directly: `mount`'s default would turn an explicit `undefined` back into the state.
        const { result } = renderHook(() =>
            usePrivateChoice({
                state: 'hidden',
                knownPaidFeatures: undefined,
                rule: 'premium',
                standing: { kind: 'unknown' },
                publication: { published: true },
                saved: RecipeVisibility.PUBLIC,
                values: PRIVATE_DRAFT,
                onChange: vi.fn(),
            }),
        );

        expect(result.current.offersPrivate).toBe(true);
        expect(result.current.field.privateRefusal).toBeUndefined();
    });

    it('under a known refusal, the field is told why a kept draft`s Private will not stand', () => {
        expect(mount('upsell', RecipeVisibility.PUBLIC, PRIVATE_DRAFT).result.current.field.privateRefusal).toBe(
            'premium',
        );
    });

    it('Not now closes the sheet, and so does See Pro (the subscription surface is not built, 010)', () => {
        const { result } = mount('upsell');

        act(() => result.current.onPremiumRequired());
        act(() => result.current.sheet.onOpenChange(false));
        expect(result.current.sheet.open).toBe(false);

        act(() => result.current.onPremiumRequired());
        act(() => result.current.sheet.onSeePremium());
        expect(result.current.sheet.open).toBe(false);
    });
});

describe('usePrivateChoice - the slots rule (a free cook`s own, book or paid-site recipe)', () => {
    it.each(['granted', 'upsell', 'hidden', 'loading'] as const)(
        'always offers Private, whatever the paid-feature state (%s)',
        (state) => {
            expect(
                mount(state, RecipeVisibility.PUBLIC, PUBLIC_DRAFT, 'slots', OPEN).result.current.offersPrivate,
            ).toBe(true);
            expect(
                mount(state, RecipeVisibility.PUBLIC, PUBLIC_DRAFT, 'slots', FULL).result.current.offersPrivate,
            ).toBe(true);
        },
    );

    it('hands the field the slot standing it draws its count and its refusal from', () => {
        const { result } = mount('upsell', RecipeVisibility.PUBLIC, PUBLIC_DRAFT, 'slots', FULL);

        expect(result.current.field).toStrictEqual({
            facts: { rule: 'slots', standing: FULL, state: 'upsell' },
            heldVisibility: RecipeVisibility.PUBLIC,
            privateRefusal: 'slots',
        });
    });

    it('⛔ a kept draft`s Private is refused only when every slot is KNOWN to be used', () => {
        expect(
            mount('upsell', RecipeVisibility.PUBLIC, PRIVATE_DRAFT, 'slots', FULL).result.current.field.privateRefusal,
        ).toBe('slots');

        for (const standing of [OPEN, { kind: 'loading' }, { kind: 'unknown' }, { kind: 'unlimited' }] as const) {
            expect(
                mount('upsell', RecipeVisibility.PUBLIC, PRIVATE_DRAFT, 'slots', standing).result.current.field
                    .privateRefusal,
            ).toBeUndefined();
        }
    });

    it('a kept draft`s Private that the slots refuse still shows the field (not the statement)', () => {
        const { result } = mount('upsell', RecipeVisibility.PUBLIC, PRIVATE_DRAFT, 'slots', FULL);

        expect(result.current.offersPrivate).toBe(true);
    });

    it('"Get Pro" from the refusal opens the Pro sheet under the upsell, and changes nothing', () => {
        const { result, onChange } = mount('upsell', RecipeVisibility.PUBLIC, PUBLIC_DRAFT, 'slots', FULL);

        act(() => result.current.onPremiumRequired());

        expect(result.current.sheet.open).toBe(true);
        expect(onChange).not.toHaveBeenCalled();
    });

    it.each(['hidden', 'loading'] as const)('"Get Pro" opens no sheet when paid features are %s', (state) => {
        const { result } = mount(state, RecipeVisibility.PUBLIC, PUBLIC_DRAFT, 'slots', FULL);

        act(() => result.current.onPremiumRequired());

        expect(result.current.sheet.open).toBe(false);
    });

    // Q5, amended: choosing Public on a private recipe says it frees a slot.
    it.each([
        ['a slot free', OPEN],
        ['every slot used', FULL],
    ] as const)(
        '⛔ with %s, choosing Public on a private recipe asks first, in the "frees a slot" words',
        (_label, standing) => {
            const { result, onChange } = mount('hidden', RecipeVisibility.PRIVATE, PRIVATE_DRAFT, 'slots', standing);

            act(() => result.current.onConfirmPublic());

            expect(result.current.confirm).toMatchObject({ open: true, consequence: 'frees' });
            expect(onChange).not.toHaveBeenCalled();
        },
    );

    it('Make public changes the draft and closes the dialog; Keep private changes nothing', () => {
        const kept = mount('hidden', RecipeVisibility.PRIVATE, PRIVATE_DRAFT, 'slots', OPEN);

        act(() => kept.result.current.onConfirmPublic());
        act(() => kept.result.current.confirm.onKeep());

        expect(kept.result.current.confirm.open).toBe(false);
        expect(kept.onChange).not.toHaveBeenCalled();
        expect(kept.result.current.statement.focusOnMount).toBe(false);

        const confirmed = mount('hidden', RecipeVisibility.PRIVATE, PRIVATE_DRAFT, 'slots', OPEN);

        act(() => confirmed.result.current.onConfirmPublic());
        act(() => confirmed.result.current.confirm.onConfirm());

        expect(confirmed.onChange).toHaveBeenCalledWith({ ...PRIVATE_DRAFT, visibility: RecipeVisibility.PUBLIC });
        expect(confirmed.result.current.confirm.open).toBe(false);
        expect(confirmed.result.current.statement.focusOnMount).toBe(true);
    });

    it('Pro (no slots to free) goes public at once, with no dialog', () => {
        const { result, onChange } = mount('granted', RecipeVisibility.PRIVATE, PRIVATE_DRAFT, 'slots', {
            kind: 'unlimited',
        });

        act(() => result.current.onConfirmPublic());

        expect(onChange).toHaveBeenCalledWith({ ...PRIVATE_DRAFT, visibility: RecipeVisibility.PUBLIC });
        expect(result.current.confirm.open).toBe(false);
    });
});

describe('usePrivateChoice - a DRAFT holds no slot (ADR-0073 section 12)', () => {
    const DRAFT = { published: false } as const;
    const draftMount = (
        values: RecipeFormValues,
        standing: SlotStanding,
        publication: { readonly published: boolean },
        saved: RecipeVisibility = RecipeVisibility.PUBLIC,
    ) => mount('hidden', saved, values, 'slots', standing, 'hidden', publication);

    it('⛔ a private draft at every slot used is NOT refused: Private stays chosen and the field gets the draft standing', () => {
        const { result } = draftMount(PRIVATE_DRAFT, FULL, DRAFT);

        expect(result.current.field.privateRefusal).toBeUndefined();
        expect(result.current.field.facts.standing).toEqual({ kind: 'draft' });
        expect(result.current.offersPrivate).toBe(true);
    });

    // REMOVED with the inline refusal (owner ruling 2026-10-26): once Publish was refused for want of a slot the field used to
    // take the cook's real standing so it could draw the refusal. The blocked-publish dialog replaces that.

    it('a published private recipe DOES hold its slot (the control group)', () => {
        const { result } = mount('hidden', RecipeVisibility.PRIVATE, PRIVATE_DRAFT, 'slots', FULL);

        expect(result.current.field.heldVisibility).toBe(RecipeVisibility.PRIVATE);
    });

    it('a published recipe keeps the real refusal (the control group: only the draft is exempt)', () => {
        const { result } = mount('hidden', RecipeVisibility.PUBLIC, PRIVATE_DRAFT, 'slots', FULL);

        expect(result.current.field.privateRefusal).toBe('slots');
    });

    it('making a private draft public asks nothing: it frees no slot, so Public is applied at once', () => {
        const { result, onChange } = draftMount(PRIVATE_DRAFT, OPEN, DRAFT, RecipeVisibility.PRIVATE);

        act(() => result.current.onConfirmPublic());

        expect(result.current.confirm.open).toBe(false);
        expect(onChange).toHaveBeenCalledWith({ ...PRIVATE_DRAFT, visibility: RecipeVisibility.PUBLIC });
    });

    it('while the recipe is published the same move asks first (the control group)', () => {
        const { result, onChange } = mount('hidden', RecipeVisibility.PRIVATE, PRIVATE_DRAFT, 'slots', OPEN);

        act(() => result.current.onConfirmPublic());

        expect(result.current.confirm.open).toBe(true);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('the premium rule is unchanged for a draft: an imported public-web recipe still needs Pro', () => {
        const { result } = mount('hidden', RecipeVisibility.PUBLIC, PRIVATE_DRAFT, 'premium', FULL, 'hidden', DRAFT);

        expect(result.current.field.privateRefusal).toBe('final');
    });
});
