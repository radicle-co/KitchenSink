/**
 * Unit tests for `sendLedger.ts`: the ONE record of what each line is sending and what failed, so the flagged list, the
 * paste list and the options sheet render from the same facts and Try again repeats THE ACTION THAT FAILED
 * (blueprint "Host gap rules" 2). Seen red first.
 *
 * The defect it removes: the flagged list's Try again was `onUseSuggestion` again, so a failed pick made from the sheet
 * was "retried" as a different action (a Use of the suggestion the cook had decided against).
 */
import { describe, expect, it } from 'vitest';

import {
    emptySendLedger,
    failedOf,
    pendingOf,
    reduceSendLedger,
    retryOf,
    type SendAttempt,
    type SendLedger,
} from '../sendLedger.js';

const WHOLE = { foodId: 'whole', name: 'Whole milk' } as const;
const USE: SendAttempt = { kind: 'useProposal', food: WHOLE };
const SHEET_PICK: SendAttempt = { kind: 'pick', pick: { kind: 'food', foodId: 'oat', name: 'Oat milk' } };
const FOUND: SendAttempt = { kind: 'searchPick', food: { foodId: 'soy', name: 'Soy milk' } };

const run = (...events: Parameters<typeof reduceSendLedger>[1][]): SendLedger =>
    events.reduce(reduceSendLedger, emptySendLedger);

describe('sendLedger', () => {
    it('started puts the attempt in flight, and pendingOf shows it as the existing PendingSend', () => {
        const ledger = run({ type: 'started', key: 'milk', attempt: USE });

        expect(pendingOf(ledger).get('milk')).toEqual(USE);
        expect(pendingOf(ledger).get('milk')?.kind).toBe('useProposal');
        expect(failedOf(ledger).has('milk')).toBe(false);
    });

    it('a second start for a line already sending is refused: the first attempt stands', () => {
        const first = run({ type: 'started', key: 'milk', attempt: USE });
        const second = reduceSendLedger(first, { type: 'started', key: 'milk', attempt: SHEET_PICK });

        expect(second).toBe(first);
        expect(pendingOf(second).get('milk')).toEqual(USE);
    });

    it('saved clears the line: nothing pending, nothing failed', () => {
        const ledger = run(
            { type: 'started', key: 'milk', attempt: USE },
            { type: 'failed', key: 'milk' },
            { type: 'started', key: 'milk', attempt: USE },
            { type: 'saved', key: 'milk' },
        );

        expect(pendingOf(ledger).size).toBe(0);
        expect(failedOf(ledger).size).toBe(0);
        expect(retryOf(ledger, 'milk')).toBeUndefined();
    });

    it('failed moves the attempt that was in flight to failed, EXACT PAYLOAD KEPT', () => {
        const ledger = run({ type: 'started', key: 'milk', attempt: SHEET_PICK }, { type: 'failed', key: 'milk' });

        expect(pendingOf(ledger).has('milk')).toBe(false);
        expect(failedOf(ledger).has('milk')).toBe(true);
        expect(retryOf(ledger, 'milk')).toEqual(SHEET_PICK);
    });

    it('REPLAY: a failed Use is retried as that Use, a failed sheet pick as that pick, a failed search pick as that food', () => {
        for (const attempt of [USE, SHEET_PICK, FOUND]) {
            const ledger = run({ type: 'started', key: 'milk', attempt }, { type: 'failed', key: 'milk' });

            expect(retryOf(ledger, 'milk')).toStrictEqual(attempt);
        }
    });

    it('a retry in flight reads as failed AND pending (what tells a retry from a first attempt), and failing again keeps the attempt', () => {
        const retrying = run(
            { type: 'started', key: 'milk', attempt: SHEET_PICK },
            { type: 'failed', key: 'milk' },
            {
                type: 'started',
                key: 'milk',
                attempt: retryOf(
                    run({ type: 'started', key: 'milk', attempt: SHEET_PICK }, { type: 'failed', key: 'milk' }),
                    'milk',
                ) as SendAttempt,
            },
        );

        expect(failedOf(retrying).has('milk')).toBe(true);
        expect(pendingOf(retrying).has('milk')).toBe(true);

        const again = reduceSendLedger(retrying, { type: 'failed', key: 'milk' });

        expect(pendingOf(again).has('milk')).toBe(false);
        expect(retryOf(again, 'milk')).toEqual(SHEET_PICK);
    });

    it('a DIFFERENT action that fails replaces the failed one: Try again repeats the latest failure', () => {
        const ledger = run(
            { type: 'started', key: 'milk', attempt: USE },
            { type: 'failed', key: 'milk' },
            { type: 'started', key: 'milk', attempt: SHEET_PICK },
            { type: 'failed', key: 'milk' },
        );

        expect(retryOf(ledger, 'milk')).toEqual(SHEET_PICK);
    });

    it('failed for a line with nothing in flight changes nothing', () => {
        const ledger = run({ type: 'started', key: 'milk', attempt: USE });

        expect(reduceSendLedger(emptySendLedger, { type: 'failed', key: 'milk' })).toBe(emptySendLedger);
        expect(reduceSendLedger(ledger, { type: 'failed', key: 'bread' })).toBe(ledger);
    });

    it('saved for a line with nothing recorded changes nothing', () => {
        expect(reduceSendLedger(emptySendLedger, { type: 'saved', key: 'milk' })).toBe(emptySendLedger);
    });

    it('lines are independent', () => {
        const ledger = run(
            { type: 'started', key: 'milk', attempt: USE },
            { type: 'started', key: 'bread', attempt: SHEET_PICK },
            { type: 'failed', key: 'bread' },
        );

        expect([...pendingOf(ledger).keys()]).toEqual(['milk']);
        expect([...failedOf(ledger)]).toEqual(['bread']);
        expect(retryOf(ledger, 'milk')).toBeUndefined();
    });
});
