/**
 * {@link usePrivateChoice} - what choosing "Private" does in the editor (E1; build spec section 6.4, 7.7 item 2; owner
 * ruling 2026-10-13; plan 2026-10-14-009 D14).
 *
 * REWRITTEN for ADR-0073 and the owner ruling of 2026-10-26: public is NEVER final. REWRITTEN again for ADR-0077 section 6:
 * the premium rule (an imported public-web recipe needing Pro) is gone, so every recipe is under the SLOTS rule. The
 * `final` and `unknown` make-public words are gone; going public from a held Private says it frees a slot.
 *
 * UPDATED for the owner ruling of 2026-10-26 (ADR-0073 section 12): the recipe is either PUBLISHED (the cook's real
 * standing decides, as every case above) or a DRAFT, which holds no slot - its last describe block. The `mount` helper
 * defaults to a published recipe, which is what the earlier cases were always about.
 */
import type { PaidFeatureState } from '@commise/features-account';
import { RecipeSourceType, RecipeVisibility } from '@kitchensink/recipe-core';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { makeRecipeFormValues } from '../../__fixtures__/index.js';
import type { RecipeFormValues } from '../../form/values.js';
import { privateRuleForDraft, type PrivateRule, type SlotStanding } from '../recipePrivateGate.js';
import { usePrivateChoice } from '../usePrivateChoice.js';

const PUBLIC_DRAFT = makeRecipeFormValues({ visibility: RecipeVisibility.PUBLIC });
const PRIVATE_DRAFT = makeRecipeFormValues({ visibility: RecipeVisibility.PRIVATE });
const OPEN: SlotStanding = { kind: 'open', used: 38, limit: 50, left: 12 };
const FULL: SlotStanding = { kind: 'full', used: 50, limit: 50 };

function mount(
    state: PaidFeatureState,
    saved: RecipeVisibility = RecipeVisibility.PUBLIC,
    values: RecipeFormValues = saved === RecipeVisibility.PRIVATE ? PRIVATE_DRAFT : PUBLIC_DRAFT,
    rule: PrivateRule = 'slots',
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

    it('REWRITTEN for ADR-0077 section 6: an imported public-web recipe is under the slots rule, draft and published alike', () => {
        const rule = privateRuleForDraft(RecipeSourceType.IMPORTED_PUBLIC);

        expect(
            mount('hidden', RecipeVisibility.PUBLIC, PRIVATE_DRAFT, rule, FULL, 'hidden', DRAFT).result.current.field
                .privateRefusal,
        ).toBeUndefined();
        expect(
            mount('hidden', RecipeVisibility.PUBLIC, PRIVATE_DRAFT, rule, FULL).result.current.field.privateRefusal,
        ).toBe('slots');
        expect(
            mount('hidden', RecipeVisibility.PUBLIC, PRIVATE_DRAFT, rule, OPEN).result.current.field.privateRefusal,
        ).toBeUndefined();
    });
});
