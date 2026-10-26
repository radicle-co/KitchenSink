/**
 * Unit tests for `pasteMatchHost.ts`: the ONE state the paste Mediator keeps — the overlay, the match requests and the
 * send ledger — and the rules that decide between answers that land later (ADR-0071 section 9; owner rulings 2026-10-25).
 * Seen red first.
 *
 * Why one reducer: an answer lands after a network call, when the render that started it is gone. A rule that reads
 * "what is true now" from a closure reads stale state; a rule inside the reducer reads the state it is applied to. So the
 * rules that matter live here: an answer for an EARLIER job is dropped (food keys repeat from job to job), a pick saves
 * the line's cook binding and marks that it saved, and a binding the REVIEW offers lands only on a line nobody has bound.
 */
import { describe, expect, it } from 'vitest';

import type { LineBinding as DraftBinding } from '../../form/lineBinding.js';
import { draftKeyOf } from '../pasteMatchSession.js';
import {
    emptyPasteMatchHost,
    reducePasteMatchHost,
    type PasteMatchHost,
    type PasteMatchHostEvent,
} from '../pasteMatchHost.js';

const run = (...events: PasteMatchHostEvent[]): PasteMatchHost =>
    events.reduce(reducePasteMatchHost, emptyPasteMatchHost);

const STARTED: PasteMatchHostEvent = { type: 'jobStarted', jobId: 'job-1' };
const JOINED: PasteMatchHostEvent = {
    type: 'overlay',
    jobId: 'job-1',
    event: { type: 'lineJoined', key: '0:0', draftKey: 'd-1' },
};
const PICK = { kind: 'food', foodId: 'oat', name: 'Oat milk' } as const;
const DRAFT: DraftBinding = { ingredientId: 'ing', isUserEntered: false, name: 'Whole milk', foodId: 'whole' };

describe('a job starts the host clean', () => {
    it('forgets the earlier job’s overlay, requests and sends', () => {
        const before = run(STARTED, JOINED, {
            type: 'ledger',
            jobId: 'job-1',
            event: { type: 'started', key: '0:0', attempt: { kind: 'pick', pick: PICK } },
        });
        const after = reducePasteMatchHost(before, { type: 'jobStarted', jobId: 'job-2' });

        expect(after.jobId).toBe('job-2');
        expect(after.session.jobId).toBe('job-2');
        expect(after.session.joins.size).toBe(0);
        expect(after.ledger.size).toBe(0);
    });

    it('a paste with no job (the daily limit) leaves nothing', () => {
        const after = reducePasteMatchHost(run(STARTED, JOINED), { type: 'jobStarted', jobId: undefined });

        expect(after.jobId).toBeUndefined();
        expect(after.session.joins.size).toBe(0);
    });

    it('restarting the same job changes nothing: nothing the cook did is lost', () => {
        const before = run(STARTED, JOINED);

        expect(reducePasteMatchHost(before, STARTED)).toBe(before);
    });
});

describe('an answer for an earlier job is dropped', () => {
    it.each<[string, PasteMatchHostEvent]>([
        [
            'an overlay event',
            { type: 'overlay', jobId: 'job-0', event: { type: 'lineJoined', key: '0:1', draftKey: 'x' } },
        ],
        ['a request event', { type: 'requests', jobId: 'job-0', event: { type: 'refused' } }],
        ['a ledger event', { type: 'ledger', jobId: 'job-0', event: { type: 'failed', key: '0:0' } }],
        [
            'a saved pick',
            { type: 'pickSaved', jobId: 'job-0', key: '0:0', attempt: { kind: 'pick', pick: PICK }, tag: undefined },
        ],
    ])('%s', (_name, event) => {
        const state = run(STARTED, JOINED);

        expect(reducePasteMatchHost(state, event)).toBe(state);
    });
});

describe('a pick that saved', () => {
    const started: PasteMatchHostEvent = {
        type: 'ledger',
        jobId: 'job-1',
        event: { type: 'started', key: '0:0', attempt: { kind: 'pick', pick: PICK } },
    };
    const saved: PasteMatchHostEvent = {
        type: 'pickSaved',
        jobId: 'job-1',
        key: '0:0',
        attempt: { kind: 'pick', pick: PICK },
        tag: 'narrow',
    };

    it('clears the send, binds the line as the cook’s, and marks that it saved, with the tag the press gave it', () => {
        const state = run(STARTED, JOINED, started, saved);

        expect(state.ledger.size).toBe(0);
        expect(state.session.bindings.get('0:0')).toEqual({ boundBy: 'cook', pick: PICK, reviewNote: undefined });
        expect(state.saved).toEqual({ key: '0:0', tag: 'narrow', seq: 1 });
    });

    it('a Use this binds the food it sent, not the line as written', () => {
        const state = run(STARTED, JOINED, {
            type: 'pickSaved',
            jobId: 'job-1',
            key: '0:0',
            attempt: { kind: 'useProposal', food: { foodId: 'whole', name: 'Whole milk' } },
            tag: undefined,
        });

        expect(state.session.bindings.get('0:0')).toMatchObject({
            boundBy: 'cook',
            pick: { kind: 'food', foodId: 'whole', name: 'Whole milk' },
        });
    });

    it('marks each save apart, so two picks on one line are two events', () => {
        const again = reducePasteMatchHost(run(STARTED, JOINED, saved), saved);

        expect(again.saved?.seq).toBe(2);
    });

    it('a pick that failed marks nothing and binds nothing', () => {
        const state = run(STARTED, JOINED, started, {
            type: 'ledger',
            jobId: 'job-1',
            event: { type: 'failed', key: '0:0' },
        });

        expect(state.saved).toBeUndefined();
        expect(state.session.bindings.size).toBe(0);
        expect(state.ledger.get('0:0')?.failed).toBeDefined();
    });
});

describe('a binding the review offers (a checking line that read confident)', () => {
    const REVIEWED: PasteMatchHostEvent = {
        type: 'reviewAdmitted',
        jobId: 'job-1',
        key: '0:0',
        binding: { boundBy: 'review', pick: { kind: 'food', foodId: 'whole', name: 'Whole milk' } },
        draft: DRAFT,
    };

    it('binds a line nobody has bound, and asks the host to re-point the draft line', () => {
        const state = run(STARTED, JOINED, REVIEWED);

        expect(state.session.bindings.get('0:0')).toMatchObject({ boundBy: 'review' });
        expect(state.rebinds.get('0:0')).toEqual(DRAFT);
    });

    it('⛔ NEVER replaces a pick the cook made: no binding, and no re-point of the draft', () => {
        const picked = run(STARTED, JOINED, {
            type: 'pickSaved',
            jobId: 'job-1',
            key: '0:0',
            attempt: { kind: 'pick', pick: PICK },
            tag: undefined,
        });
        const state = reducePasteMatchHost(picked, REVIEWED);

        expect(state.session.bindings.get('0:0')).toMatchObject({ boundBy: 'cook', pick: PICK });
        expect(state.rebinds.size).toBe(0);
    });

    it('the host clears a re-point once it has applied it', () => {
        const state = reducePasteMatchHost(run(STARTED, JOINED, REVIEWED), { type: 'rebindApplied', key: '0:0' });

        expect(state.rebinds.size).toBe(0);
        expect(state.session.bindings.get('0:0')).toMatchObject({ boundBy: 'review' });
    });

    it('a line the cook deleted is never bound or re-pointed', () => {
        const state = run(
            STARTED,
            JOINED,
            {
                type: 'overlay',
                jobId: 'job-1',
                event: { type: 'draftLineRemoved', draftKey: 'd-1' },
            },
            REVIEWED,
        );

        expect(state.session.bindings.size).toBe(0);
        expect(state.rebinds.size).toBe(0);
        expect(draftKeyOf(state.session, '0:0')).toBeUndefined();
    });

    it('clears the send the review’s admission held', () => {
        const state = run(
            STARTED,
            JOINED,
            {
                type: 'ledger',
                jobId: 'job-1',
                event: {
                    type: 'started',
                    key: '0:0',
                    attempt: { kind: 'useProposal', food: { foodId: 'whole', name: 'Whole milk' } },
                },
            },
            REVIEWED,
        );

        expect(state.ledger.size).toBe(0);
    });
});
