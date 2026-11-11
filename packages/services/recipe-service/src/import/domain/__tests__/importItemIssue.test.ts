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
};
const issue = (patch: Partial<ItemIssueFacts>) => importItemIssueOf({ ...READY, ...patch });

describe('importItemIssueOf', () => {
    it('is none for an item that could save now', () => {
        expect(issue({})).toBeNull();
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

    it('puts a refused visibility ahead of the slot pause (the cook fixes the label first)', () => {
        expect(issue({ private: true, outOfSlots: true, visibilityRefused: true })).toBe('visibilityRefused');
    });
});
