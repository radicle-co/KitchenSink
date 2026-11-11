/**
 * Where a verification key's review stands when no verdict is on record (F10, ADR-0040, ADR-0072 §6).
 *
 * One rule for the paste screen, the bulk import's wizard and its flag lists, so a spent budget or a given-up review cannot
 * read as `checking` on one screen and as settled on another. The order is the claim: a spent budget comes first, because it
 * is the only reason a review is owed and will not be sent.
 */
import { describe, expect, it } from 'vitest';

import { reviewStandingOf, type ReviewStandingRead } from '../reviewStanding.js';

const NONE: ReviewStandingRead = { exhausted: new Set(), budgetSpent: new Set(), contained: false };

describe('reviewStandingOf', () => {
    it('is `asked` for a key with nothing on record, and `notAsked` for a contained test principal', () => {
        expect(reviewStandingOf('k', false, NONE)).toBe('asked');
        expect(reviewStandingOf('k', false, { ...NONE, contained: true })).toBe('notAsked');
    });

    it('reads the persisted refusal, then a key the gate gave up on', () => {
        expect(reviewStandingOf('k', true, NONE)).toBe('refused');
        expect(reviewStandingOf('k', false, { ...NONE, exhausted: new Set(['k']) })).toBe('exhausted');
        expect(reviewStandingOf('k', true, { ...NONE, exhausted: new Set(['k']) })).toBe('refused');
    });

    it('⛔ puts a spent budget first: it outranks a refusal, a give-up and containment', () => {
        const spent = { exhausted: new Set(['k']), budgetSpent: new Set(['k']), contained: true };

        expect(reviewStandingOf('k', true, spent)).toBe('budgetSpent');
    });

    it('reads only THIS key: another key spent or given up on changes nothing', () => {
        expect(reviewStandingOf('k', false, { ...NONE, budgetSpent: new Set(['j']), exhausted: new Set(['j']) })).toBe(
            'asked',
        );
    });

    it('a line with no key has nothing spent or given up on it', () => {
        expect(reviewStandingOf(null, false, { ...NONE, budgetSpent: new Set(['k']) })).toBe('asked');
    });
});
