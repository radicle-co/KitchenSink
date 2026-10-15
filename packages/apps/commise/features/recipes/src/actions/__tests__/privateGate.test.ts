/**
 * THE client rule for "Private" (plan 2026-10-14-009 D14; owner ruling 2026-10-13; UX spec in the plan): every surface
 * that offers Private — the editor field, the recipe ⋯ menu, a collection ⋯ menu and its Undo — asks these.
 *
 * `granted` uses the paid feature; `upsell` offers Premium; `hidden` shows neither; `loading` fails closed. A thing
 * that is ALREADY private stays private and shows so, in every state: going back to what the server holds needs no
 * entitlement.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import {
    mayRestorePrivate,
    offersPrivate,
    privateChoice,
    privateIsFinal,
    privateNeedsPremium,
    showsPremiumBadge,
} from '../privateGate.js';

const { PUBLIC, PRIVATE } = RecipeVisibility;
const STATES = ['loading', 'granted', 'upsell', 'hidden'] as const;

describe('offersPrivate', () => {
    it.each([
        ['loading', false],
        ['granted', true],
        ['upsell', true],
        ['hidden', false],
    ] as const)('for a public thing, %s → %s', (state, expected) => {
        expect(offersPrivate(state, PUBLIC)).toBe(expected);
    });

    it.each(STATES.map((state) => [state]))('always for a thing that is already private (%s)', (state) => {
        expect(offersPrivate(state, PRIVATE)).toBe(true);
    });
});

describe('privateChoice — what choosing a visibility does', () => {
    it.each(STATES.map((state) => [state]))('choosing Public always applies (%s)', (state) => {
        expect(privateChoice({ target: PUBLIC, saved: PRIVATE, state })).toBe('apply');
        expect(privateChoice({ target: PUBLIC, saved: PUBLIC, state })).toBe('apply');
    });

    it.each([
        ['granted', 'apply'],
        ['upsell', 'upsell'],
        ['hidden', 'none'],
        ['loading', 'none'],
    ] as const)('choosing Private for a public thing, %s → %s', (state, expected) => {
        expect(privateChoice({ target: PRIVATE, saved: PUBLIC, state })).toBe(expected);
    });

    it.each(STATES.map((state) => [state]))('choosing Private back for a saved-private thing applies (%s)', (state) => {
        expect(privateChoice({ target: PRIVATE, saved: PRIVATE, state })).toBe('apply');
    });
});

describe('privateNeedsPremium', () => {
    it('is true ONLY for upsell, choosing Private for a public thing', () => {
        for (const state of STATES) {
            for (const saved of [PUBLIC, PRIVATE]) {
                for (const target of [PUBLIC, PRIVATE]) {
                    const expected = state === 'upsell' && saved === PUBLIC && target === PRIVATE;

                    expect(privateNeedsPremium({ target, saved, state }), `${state} ${saved}→${target}`).toBe(expected);
                }
            }
        }
    });
});

describe('showsPremiumBadge', () => {
    it('is shown only under upsell, and never on a thing already private', () => {
        expect(showsPremiumBadge('upsell', PUBLIC)).toBe(true);
        expect(showsPremiumBadge('upsell', PRIVATE)).toBe(false);

        for (const state of ['loading', 'granted', 'hidden'] as const) {
            expect(showsPremiumBadge(state, PUBLIC), state).toBe(false);
        }
    });
});

describe('privateIsFinal — making a private thing public cannot be undone', () => {
    it('only under hidden, for a thing that is private', () => {
        expect(privateIsFinal('hidden', PRIVATE)).toBe(true);
        expect(privateIsFinal('hidden', PUBLIC)).toBe(false);

        for (const state of ['loading', 'granted', 'upsell'] as const) {
            expect(privateIsFinal(state, PRIVATE), state).toBe(false);
        }
    });
});

describe('mayRestorePrivate — an Undo back to private', () => {
    it.each([
        ['granted', true],
        ['upsell', false],
        ['hidden', false],
        ['loading', false],
    ] as const)('%s → %s', (state, expected) => {
        expect(mayRestorePrivate(state)).toBe(expected);
    });
});
