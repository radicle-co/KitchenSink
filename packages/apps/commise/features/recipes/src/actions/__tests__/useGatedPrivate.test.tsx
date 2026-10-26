/**
 * {@link useGatedPrivate} - asking for Private, for every recipe surface that offers it (the editor's visibility field,
 * the recipe page's menu). It applies, opens the Premium sheet, or does nothing, as `recipePrivateChoice` decides.
 *
 * REWRITTEN for ADR-0073 (owner ruling 2026-10-26). It used to decide from the paid-feature state alone. A recipe is now
 * under the SLOTS rule (Private works while a slot is free, paid features or not) or, for an imported public-web recipe,
 * the PREMIUM rule (the old table, unchanged: loading fails closed there). The sheet still opens only under `upsell`, and
 * closes if the state leaves it; it can also be opened directly (the refusal's "Get Premium").
 */
import type { PaidFeatureState } from '@commise/features-account';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RecipePrivateFacts } from '../recipePrivateGate.js';
import { useGatedPrivate } from '../useGatedPrivate.js';

const OPEN = { kind: 'open', used: 49, limit: 50, left: 1 } as const;
const FULL = { kind: 'full', used: 50, limit: 50 } as const;

const premiumRule = (state: PaidFeatureState): RecipePrivateFacts => ({
    rule: 'premium',
    standing: { kind: 'unknown' },
    state,
});
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

describe('useGatedPrivate - the premium rule (an imported public-web recipe)', () => {
    it('applies Private at once for a granted cook, with no sheet', () => {
        const { result, apply } = mount(premiumRule('granted'));

        act(() => result.current.request());

        expect(apply).toHaveBeenCalledTimes(1);
        expect(result.current.sheet.open).toBe(false);
    });

    it('⛔ opens the Premium sheet under upsell and applies nothing', () => {
        const { result, apply } = mount(premiumRule('upsell'));

        act(() => result.current.request());

        expect(result.current.sheet.open).toBe(true);
        expect(apply).not.toHaveBeenCalled();
    });

    it.each(['hidden', 'loading'] as const)('⛔ under %s neither applies nor opens a sheet', (state) => {
        const { result, apply } = mount(premiumRule(state));

        act(() => result.current.request());

        expect(result.current.sheet.open).toBe(false);
        expect(apply).not.toHaveBeenCalled();
    });

    it.each(['hidden', 'loading', 'upsell'] as const)(
        're-applies Private to a saved-private recipe under %s',
        (state) => {
            const { result, apply } = mount(premiumRule(state), RecipeVisibility.PRIVATE);

            act(() => result.current.request());

            expect(apply).toHaveBeenCalledTimes(1);
            expect(result.current.sheet.open).toBe(false);
        },
    );

    it.each([
        ['loading', false],
        ['granted', true],
        ['upsell', true],
        ['hidden', false],
    ] as const)('offers Private for a public recipe under %s: %s', (state, offers) => {
        expect(mount(premiumRule(state)).result.current.offersPrivate).toBe(offers);
    });
});

describe('useGatedPrivate - the slots rule (a free cook`s own, book or paid-site recipe)', () => {
    it.each([
        ['a slot free', OPEN],
        ['Premium', { kind: 'unlimited' }],
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

    it('always offers Private: paid features cannot hide it', () => {
        for (const state of ['granted', 'upsell', 'hidden', 'loading'] as const) {
            expect(mount(slotsRule(FULL, state)).result.current.offersPrivate).toBe(true);
        }
    });
});

describe('useGatedPrivate - the Premium sheet', () => {
    it('Not now and See Premium both close the sheet (the subscription surface is not built, 010)', () => {
        const { result } = mount(premiumRule('upsell'));

        act(() => result.current.request());
        act(() => result.current.sheet.onOpenChange(false));
        expect(result.current.sheet.open).toBe(false);

        act(() => result.current.request());
        act(() => result.current.sheet.onSeePremium());
        expect(result.current.sheet.open).toBe(false);
    });

    it('can be opened directly - the refusal`s "Get Premium" - under the slots rule with the upsell', () => {
        const { result } = mount(slotsRule(FULL, 'upsell'));

        act(() => result.current.showPremium());

        expect(result.current.sheet.open).toBe(true);
    });

    it('the slots rule`s sheet is the noSlot variant, carrying the server`s limit', () => {
        const { result } = mount(slotsRule({ kind: 'full', used: 60, limit: 50 }, 'upsell'));

        act(() => result.current.showPremium());

        expect(result.current.sheet.variant).toEqual({ kind: 'noSlot', total: 50 });
    });

    it('the premium rule`s sheet is the webImport variant', () => {
        const { result } = mount(premiumRule('upsell'));

        act(() => result.current.request());

        expect(result.current.sheet.open).toBe(true);
        expect(result.current.sheet.variant).toEqual({ kind: 'webImport' });
    });

    it.each([
        ['a slot free', OPEN],
        ['Premium', { kind: 'unlimited' }],
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
        const { result, rerender } = mount(premiumRule('upsell'));

        act(() => result.current.request());
        rerender({ facts: premiumRule('granted') });

        expect(result.current.sheet.open).toBe(false);
    });
});
