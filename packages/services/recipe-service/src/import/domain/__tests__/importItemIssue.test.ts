/**
 * Why an item cannot be saved yet, as an opaque key (ADR-0072 §9; the contract's `issue`). Derived at read time and never
 * stored: a stored issue goes stale the moment the cook fixes it.
 */
import { describe, expect, it } from 'vitest';

import { importItemIssueOf, type ItemIssueFacts } from '../importItemIssue.js';

const READY: ItemIssueFacts = {
    stage: 'matched',
    hasStatement: true,
    visibilityRefused: false,
    private: false,
    outOfSlots: false,
    paid: true,
    allowanceSpent: false,
    refusal: null,
    saveGap: null,
    heldAtCurrentRevision: false,
};
const issue = (patch: Partial<ItemIssueFacts>) => importItemIssueOf({ ...READY, ...patch });

describe('importItemIssueOf', () => {
    it('is none for an item that could save now', () => {
        expect(issue({})).toBeNull();
    });

    // Review item 7 on #220: an item the save held for a reason no rule above names (a create refusal the pre-check did not
    // predict, or a payload the save cannot read) used to show no issue and stall silently.
    it('⛔ names a held item no other rule explains as `saveRefused`, derived from the hold, never stored', () => {
        expect(issue({ heldAtCurrentRevision: true })).toBe('saveRefused');
        expect(issue({ heldAtCurrentRevision: true, private: true, outOfSlots: true })).toBe('saveRefused');
    });

    it('lets every named reason win over `saveRefused`, so the cook is told what to fix', () => {
        expect(issue({ heldAtCurrentRevision: true, hasStatement: false })).toBe('needsStatement');
        expect(issue({ heldAtCurrentRevision: true, visibilityRefused: true })).toBe('visibilityRefused');
        expect(issue({ heldAtCurrentRevision: true, saveGap: 'servings' })).toBe('needsServings');
        expect(issue({ heldAtCurrentRevision: true, refusal: 'noSteps' })).toBe('noSteps');
    });

    it('reads a hold only on a matched item: a saved one has no issue', () => {
        expect(issue({ heldAtCurrentRevision: true, stage: 'saved' })).toBeNull();
    });

    it('is none for a saved item, whatever else is true of the import', () => {
        expect(
            issue({ stage: 'saved', hasStatement: false, visibilityRefused: true, private: true, outOfSlots: true }),
        ).toBeNull();
    });

    it('says an unpaid received item is waiting for the allowance once it is spent', () => {
        expect(issue({ stage: 'received', paid: false, allowanceSpent: true })).toBe('waitingForAllowance');
        expect(issue({ stage: 'received', paid: false, allowanceSpent: false })).toBeNull();
        // Paid already: the allowance no longer matters to it.
        expect(issue({ stage: 'received', paid: true, allowanceSpent: true })).toBeNull();
    });

    it('asks for the statement only when the item would otherwise be saved (a matched item)', () => {
        expect(issue({ hasStatement: false })).toBe('needsStatement');
        expect(issue({ stage: 'parsing', hasStatement: false, paid: true })).toBeNull();
        expect(issue({ stage: 'received', hasStatement: false, paid: true })).toBeNull();
    });

    it('names a refused visibility, after the statement', () => {
        expect(issue({ visibilityRefused: true })).toBe('visibilityRefused');
        expect(issue({ visibilityRefused: true, hasStatement: false })).toBe('needsStatement');
    });

    it('pauses a PRIVATE item when the cook is out of slots, and only a private one', () => {
        expect(issue({ private: true, outOfSlots: true })).toBe('outOfSlots');
        expect(issue({ private: false, outOfSlots: true })).toBeNull();
        expect(issue({ private: true, outOfSlots: false })).toBeNull();
    });

    it('⛔ names what the save still needs, one key per gap (ADR-0072 §3 as amended 2026-11-11)', () => {
        expect(issue({ saveGap: 'cuisine' })).toBe('needsCuisine');
        expect(issue({ saveGap: 'servings' })).toBe('needsServings');
        expect(issue({ saveGap: 'times' })).toBe('needsTimes');
    });

    it('asks for a save gap only on a matched item, after the statement and the visibility, before the slots', () => {
        expect(issue({ stage: 'parsing', saveGap: 'cuisine' })).toBeNull();
        // The statement can lift the cuisine requirement (a public-domain import needs none), so it is asked first.
        expect(issue({ hasStatement: false, saveGap: 'cuisine' })).toBe('needsStatement');
        expect(issue({ visibilityRefused: true, saveGap: 'cuisine' })).toBe('visibilityRefused');
        // A recipe that cannot be saved uses no slot, so the slot pause is not its reason.
        expect(issue({ private: true, outOfSlots: true, saveGap: 'times' })).toBe('needsTimes');
    });

    it('⛔ names a refusal FIRST: before the allowance wait and before the matched-stage early return', () => {
        expect(issue({ stage: 'received', paid: false, allowanceSpent: true, refusal: 'noIngredients' })).toBe(
            'noIngredients',
        );
        expect(issue({ stage: 'received', paid: false, allowanceSpent: false, refusal: 'noSteps' })).toBe('noSteps');
        expect(issue({ stage: 'received', paid: true, hasStatement: false, refusal: 'noSteps' })).toBe('noSteps');
        expect(issue({ hasStatement: false, saveGap: 'cuisine', refusal: 'noIngredients' })).toBe('noIngredients');
    });

    it('a refusal does not outrank a saved item (a saved item has no issue)', () => {
        expect(issue({ stage: 'saved', refusal: 'noSteps' })).toBeNull();
    });

    it('puts a refused visibility ahead of the slot pause (the cook fixes the label first)', () => {
        expect(issue({ private: true, outOfSlots: true, visibilityRefused: true })).toBe('visibilityRefused');
    });
});
