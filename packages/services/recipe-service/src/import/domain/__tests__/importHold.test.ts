/**
 * Why an import item is held, and whether that hold still applies to the cook asking (review M1 on #220).
 *
 * A hold used to be a bare revision, so a hold whose cause changed WITHOUT a decision of the cook stayed forever: a cook held
 * for the label under one plan or containment, then upgraded, was never looked at again, and the list named the hold
 * `saveRefused`. Each case here kills one way back to that: a hold that ignores the cook's facts, one that ignores the
 * revision, and a `saveRefused` that names a hold the cook can fix.
 */
import { describe, expect, it } from 'vitest';

import { cookKeyOf, holdApplies, holdOf, isSaveRefusedHold, type HeldItem } from '../importHold.js';

const FREE = { principalKind: 'real', containment: 'enforce', isPremium: false } as const;
const PRO = { ...FREE, isPremium: true } as const;
const CONTAINED = { principalKind: 'test', containment: 'enforce', isPremium: false } as const;
const UNCONTAINED = { ...CONTAINED, containment: 'off' } as const;

const held = (patch: Partial<HeldItem> = {}): HeldItem => ({
    heldAtRev: 4,
    decisionRev: 4,
    heldReason: 'item',
    heldCookKey: null,
    ...patch,
});

describe('cookKeyOf: the cook facts a hold was judged under', () => {
    it('differs for each fact the label and the create read: plan, containment and principal kind', () => {
        const keys = new Set([FREE, PRO, CONTAINED, UNCONTAINED].map(cookKeyOf));

        expect(keys.size).toBe(4);
    });

    it('is the same for the same facts', () => {
        expect(cookKeyOf({ ...FREE })).toBe(cookKeyOf(FREE));
    });
});

describe('holdOf: what a hold records', () => {
    it('records only the reason for a cause inside the item, which only a decision of the cook changes', () => {
        expect(holdOf('item', FREE)).toStrictEqual({ reason: 'item', cookKey: null });
        expect(holdOf('unreadable', FREE)).toStrictEqual({ reason: 'unreadable', cookKey: null });
    });

    it('records the cook facts for a cause they decide: the label and a create refusal', () => {
        expect(holdOf('visibility', FREE)).toStrictEqual({ reason: 'visibility', cookKey: cookKeyOf(FREE) });
        expect(holdOf('createRefused', FREE)).toStrictEqual({ reason: 'createRefused', cookKey: cookKeyOf(FREE) });
    });
});

describe('holdApplies: whether the hold keeps the item out of the save queue for this cook', () => {
    it('does not apply once a decision moved the revision past it, whatever its reason', () => {
        expect(holdApplies(held({ decisionRev: 5 }), cookKeyOf(FREE))).toBe(false);
        expect(holdApplies(held({ heldAtRev: null }), cookKeyOf(FREE))).toBe(false);
    });

    it('applies to every cook for a cause inside the item', () => {
        expect(holdApplies(held(), cookKeyOf(PRO))).toBe(true);
        expect(holdApplies(held({ heldReason: 'unreadable' }), cookKeyOf(PRO))).toBe(true);
    });

    it('⛔ applies to the cook it was judged under only, for a cause the cook facts decide', () => {
        const forFree = held({ heldReason: 'visibility', heldCookKey: cookKeyOf(FREE) });
        const refusedForFree = held({ heldReason: 'createRefused', heldCookKey: cookKeyOf(FREE) });

        expect(holdApplies(forFree, cookKeyOf(FREE))).toBe(true);
        expect(holdApplies(forFree, cookKeyOf(PRO))).toBe(false);
        expect(holdApplies(refusedForFree, cookKeyOf(PRO))).toBe(false);
        expect(
            holdApplies(held({ heldReason: 'visibility', heldCookKey: cookKeyOf(CONTAINED) }), cookKeyOf(UNCONTAINED)),
        ).toBe(false);
    });

    it('reads a hold written before reasons were recorded as a cause inside the item: only a decision releases it', () => {
        expect(holdApplies(held({ heldReason: null }), cookKeyOf(PRO))).toBe(true);
    });
});

describe('isSaveRefusedHold: whether the list names the hold `saveRefused`', () => {
    it('names a create refusal or an unreadable payload that still applies', () => {
        expect(
            isSaveRefusedHold(held({ heldReason: 'createRefused', heldCookKey: cookKeyOf(FREE) }), cookKeyOf(FREE)),
        ).toBe(true);
        expect(isSaveRefusedHold(held({ heldReason: 'unreadable' }), cookKeyOf(FREE))).toBe(true);
    });

    it('⛔ never names a hold the cook can see the reason for, or one that no longer applies', () => {
        expect(isSaveRefusedHold(held(), cookKeyOf(FREE))).toBe(false);
        expect(
            isSaveRefusedHold(held({ heldReason: 'visibility', heldCookKey: cookKeyOf(FREE) }), cookKeyOf(FREE)),
        ).toBe(false);
        expect(
            isSaveRefusedHold(held({ heldReason: 'createRefused', heldCookKey: cookKeyOf(FREE) }), cookKeyOf(PRO)),
        ).toBe(false);
        expect(isSaveRefusedHold(held({ heldReason: 'unreadable', decisionRev: 5 }), cookKeyOf(FREE))).toBe(false);
    });
});
