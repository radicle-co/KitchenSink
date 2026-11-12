/**
 * {@link useGatedPrivate} - asking for Private, for every recipe surface that offers it (the editor's visibility field,
 * the recipe page's menu). It applies, opens the Pro sheet, or does nothing, as `recipePrivateChoice` decides.
 *
 * REWRITTEN for ADR-0073 (owner ruling 2026-10-26), then for ADR-0077 section 6 ("Any cook, using a slot"): the premium
 * rule is gone, so every recipe, an imported public-web one included, is under the SLOTS rule (Private works while a slot
 * is free, paid features or not). The sheet opens only when asked directly (the refusal's "Get Pro") under `upsell`, and
 * closes if the state leaves it.
 */
import type { PaidFeatureState } from '@commise/features-account';
import { RecipeSourceType, RecipeVisibility } from '@kitchensink/recipe-core';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { privateRuleForDraft, type RecipePrivateFacts } from '../recipePrivateGate.js';
import { useGatedPrivate } from '../useGatedPrivate.js';

const OPEN = { kind: 'open', used: 49, limit: 50, left: 1 } as const;
const FULL = { kind: 'full', used: 50, limit: 50 } as const;

const slotsRule = (
    standing: RecipePrivateFacts['standing'],
    state: PaidFeatureState = 'upsell',
): RecipePrivateFacts => ({
    rule: 'slots',
    standing,
    state,
});

function mount(facts: RecipePrivateFacts, saved: RecipeVisibility = RecipeVisibility.PUBLIC) {
    const apply = vi.fn<() => void>();
    const view = renderHook(
        (props: { readonly facts: RecipePrivateFacts }) => useGatedPrivate({ facts: props.facts, saved, apply }),
        {
            initialProps: { facts },
        },
    );

    return { ...view, apply };
}

describe('useGatedPrivate - an imported public-web recipe (REWRITTEN for ADR-0077 section 6)', () => {
    const importedPublic = (standing: RecipePrivateFacts['standing'], state: PaidFeatureState): RecipePrivateFacts => ({
        rule: privateRuleForDraft(RecipeSourceType.IMPORTED_PUBLIC, null),
        standing,
        state,
    });

    it.each(['granted', 'upsell', 'hidden', 'loading'] as const)(
        'applies Private at once with a slot free, whatever the paid-feature state (%s)',
        (state) => {
            const { result, apply } = mount(importedPublic(OPEN, state));

            act(() => result.current.request());

            expect(apply).toHaveBeenCalledTimes(1);
            expect(result.current.sheet.open).toBe(false);
        },
    );

    it('with every slot used, applies nothing, exactly as a recipe the cook wrote', () => {
        const { result, apply } = mount(importedPublic(FULL, 'upsell'));

        act(() => result.current.request());

        expect(apply).not.toHaveBeenCalled();
        expect(result.current.sheet.open).toBe(false);
    });
});

describe('useGatedPrivate - the slots rule (a free cook`s own, book or paid-site recipe)', () => {
    it.each([
        ['a slot free', OPEN],
        ['Pro', { kind: 'unlimited' }],
        ['loading', { kind: 'loading' }],
        ['a failed read', { kind: 'unknown' }],
    ] as const)('applies Private at once with %s, whatever the paid-feature state', (_label, standing) => {
        for (const state of ['granted', 'upsell', 'hidden', 'loading'] as const) {
            const { result, apply } = mount(slotsRule(standing, state));

            act(() => result.current.request());

            expect(apply).toHaveBeenCalledTimes(1);
            expect(result.current.sheet.open).toBe(false);
        }
    });

    it('⛔ with every slot used, applies nothing and opens no sheet: the field already shows why', () => {
        const { result, apply } = mount(slotsRule(FULL));

        act(() => result.current.request());

        expect(apply).not.toHaveBeenCalled();
        expect(result.current.sheet.open).toBe(false);
    });

    // The recipe page's menu has no field to show the refusal in, so it SENDS the request and lets the server's 403 say it
    // (`useServerRefusedPrivate` -> the notice). The count is a display fact; the server decides every write.
    it('⛔ calls `whenFull` for a Private with every slot used, where a host with no refusal of its own wants the server`s answer', () => {
        const whenFull = vi.fn<() => void>();
        const apply = vi.fn<() => void>();
        const { result } = renderHook(() =>
            useGatedPrivate({ facts: slotsRule(FULL), saved: RecipeVisibility.PUBLIC, apply, whenFull }),
        );

        act(() => result.current.request());

        expect(whenFull).toHaveBeenCalledTimes(1);
        expect(apply).not.toHaveBeenCalled();
    });

    it('does not call `whenFull` while a slot may be free', () => {
        const whenFull = vi.fn<() => void>();
        const { result } = renderHook(() =>
            useGatedPrivate({ facts: slotsRule(OPEN), saved: RecipeVisibility.PUBLIC, apply: vi.fn(), whenFull }),
        );

        act(() => result.current.request());

        expect(whenFull).not.toHaveBeenCalled();
    });
});

describe('useGatedPrivate - the Pro sheet', () => {
    it('Not now and See Pro both close the sheet (the subscription surface is not built, 010)', () => {
        const { result } = mount(slotsRule(FULL, 'upsell'));

        act(() => result.current.showPremium());
        act(() => result.current.sheet.onOpenChange(false));
        expect(result.current.sheet.open).toBe(false);

        act(() => result.current.showPremium());
        act(() => result.current.sheet.onSeePremium());
        expect(result.current.sheet.open).toBe(false);
    });

    it('can be opened directly - the refusal`s "Get Pro" - under the slots rule with the upsell', () => {
        const { result } = mount(slotsRule(FULL, 'upsell'));

        act(() => result.current.showPremium());

        expect(result.current.sheet.open).toBe(true);
    });

    it('the slots rule`s sheet is the noSlot variant, carrying the server`s limit', () => {
        const { result } = mount(slotsRule({ kind: 'full', used: 60, limit: 50 }, 'upsell'));

        act(() => result.current.showPremium());

        expect(result.current.sheet.variant).toEqual({ kind: 'noSlot', total: 50 });
    });

    it.each([
        ['a slot free', OPEN],
        ['Pro', { kind: 'unlimited' }],
        ['loading', { kind: 'loading' }],
        ['a failed read', { kind: 'unknown' }],
    ] as const)('⛔ a free cook with %s never sees the sheet, even asked for it directly', (_label, standing) => {
        const { result } = mount(slotsRule(standing, 'upsell'));

        act(() => result.current.showPremium());

        expect(result.current.sheet.open).toBe(false);
    });

    it.each(['hidden', 'loading', 'granted'] as const)(
        '⛔ showPremium opens nothing when paid features are %s',
        (state) => {
            const { result } = mount(slotsRule(FULL, state));

            act(() => result.current.showPremium());

            expect(result.current.sheet.open).toBe(false);
        },
    );

    /** A refetch that changes the answer while the sheet is up: an upsell for a plan the cook now has must close. */
    it('closes an open sheet when the state leaves upsell', () => {
        const { result, rerender } = mount(slotsRule(FULL, 'upsell'));

        act(() => result.current.showPremium());
        expect(result.current.sheet.open).toBe(true);
        rerender({ facts: slotsRule(FULL, 'granted') });

        expect(result.current.sheet.open).toBe(false);
    });
});
