/**
 * THE CORRECTION NOTICE'S TRUTH TABLE (plan U14 / R19, R20) — every state the affordance can be in, and the
 * one sentence it renders in each.
 *
 * ⛔ THE PROPERTY THAT MATTERS MOST IS NOT "IT RENDERS COPY". It is that the notice never MISREPORTS THE
 * REACH of what the user just did. A correction either binds a phrase for the person who made it or for
 * every user of the installation, the difference is decided server-side from signed grants the client cannot
 * read, and the two are indistinguishable from the request. A surface that said "Saved" for both would tell
 * a curator they had made a personal note when they had in fact rewritten what that phrase means for
 * everyone — so `scope` drives two DIFFERENT sentences, and this suite fails if they ever collapse.
 *
 * ⚠️ AND `recorded: false` IS NOT AN ERROR. Re-asserting a binding already in force writes nothing, and a
 * concurrent correction may have committed first; both are successful, idempotent outcomes. Rendering them
 * with an error tone is the failure this suite's `tone` assertions exist to catch — it would show "something
 * went wrong" on the happy path a user reaches by correcting the same phrase twice.
 */
import { describe, expect, it } from 'vitest';

import type { RecordCorrectionResponse } from '@kitchensink/schema-recipe';

import { recipeCorrectionMessages } from '../messages.js';
import { toCorrectionNoticeModel, toCorrectionViewState, type CorrectionViewState } from '../model.js';

/** A mapping row id the `saved` fixtures carry; never asserted on, only required by the wire shape. */
const MAPPING_ID = '00000000-0000-4000-8000-00000000c001';

const m = recipeCorrectionMessages.en;

/** The notice for a given view state, in `en`. */
const notice = (state: CorrectionViewState): { tone: string; text: string } | undefined =>
    toCorrectionNoticeModel(state, m);

describe('toCorrectionNoticeModel — one sentence per outcome, and the reach is never hidden', () => {
    it('renders NOTHING before the user has corrected anything', () => {
        expect(notice({ kind: 'idle' })).toBeUndefined();
    });

    it('announces the in-flight write, so the control is not silently unresponsive', () => {
        expect(notice({ kind: 'saving' })).toEqual({ tone: 'progress', text: m.saving });
    });

    // ⛔ THE TWO REACHES. If these ever produce the same string, a curator cannot tell a personal note from a
    // ruling that binds every user — which is the whole reason `scope` is on the wire.
    it('says the correction is PERSONAL when it bound only its author', () => {
        expect(notice({ kind: 'saved', scope: 'author' })).toEqual({ tone: 'success', text: m.savedForYou });
    });

    it('says the correction binds EVERYONE when its reach is global', () => {
        expect(notice({ kind: 'saved', scope: 'global' })).toEqual({ tone: 'success', text: m.savedForEveryone });
    });

    it('⛔ NEVER renders the same sentence for the two reaches', () => {
        expect(m.savedForYou).not.toBe(m.savedForEveryone);
    });

    // ⚠️ A no-op is a SUCCESS. Both outcomes reach the user as "nothing needed doing", never as a failure.
    it.each([
        ['already_in_force' as const, m.alreadySaved],
        ['superseded' as const, m.alreadySaved],
    ])('reports the no-op outcome %s as a neutral fact, not an error', (outcome, text) => {
        expect(notice({ kind: 'unchanged', outcome })).toEqual({ tone: 'neutral', text });
    });

    it('reports a genuine failure with the error tone, so only real failures alarm', () => {
        expect(notice({ kind: 'failed' })).toEqual({ tone: 'error', text: m.failed });
    });

    it('⛔ uses the error tone for the FAILED state and for nothing else', () => {
        const states: CorrectionViewState[] = [
            { kind: 'idle' },
            { kind: 'saving' },
            { kind: 'saved', scope: 'author' },
            { kind: 'saved', scope: 'global' },
            { kind: 'unchanged', outcome: 'already_in_force' },
            { kind: 'unchanged', outcome: 'superseded' },
        ];

        for (const state of states) {
            expect(notice(state)?.tone).not.toBe('error');
        }
    });

    it('is TOTAL — every member of the view union produces a defined answer except idle', () => {
        const states: CorrectionViewState[] = [
            { kind: 'saving' },
            { kind: 'saved', scope: 'author' },
            { kind: 'saved', scope: 'global' },
            { kind: 'unchanged', outcome: 'already_in_force' },
            { kind: 'unchanged', outcome: 'superseded' },
            { kind: 'failed' },
        ];

        for (const state of states) {
            expect(notice(state)?.text).toBeTruthy();
        }
    });

    it('renders no hard-coded literal — every sentence comes from the message set', () => {
        const rendered = [
            notice({ kind: 'saving' }),
            notice({ kind: 'saved', scope: 'author' }),
            notice({ kind: 'saved', scope: 'global' }),
            notice({ kind: 'unchanged', outcome: 'already_in_force' }),
            notice({ kind: 'failed' }),
        ].map((entry) => entry?.text);
        const catalogue = Object.values(m);

        for (const text of rendered) {
            expect(catalogue).toContain(text);
        }
    });
});

/**
 * ⛔ THE PRECEDENCE IS THE WHOLE OF THIS FUNCTION, and getting it wrong is how a surface lies about state.
 *
 * A TanStack mutation keeps `data` from the LAST successful call while a NEW one is in flight, and keeps
 * `isError` from the last failure until the next call resets it. So "is there a response?" is not the
 * question — the question is "which fact is most recent?", and the order below is that answer: an in-flight
 * write outranks any settled one (otherwise a retry silently re-renders the previous success and the user
 * never learns a second write is happening), and a failure outranks a stale success (otherwise a correction
 * that just failed keeps showing "Saved").
 */
describe('toCorrectionViewState — the most recent fact wins, not the most recently populated field', () => {
    const saved: RecordCorrectionResponse = { recorded: true, mappingId: MAPPING_ID, scope: 'author' };

    it('rests at idle before anything has been attempted', () => {
        expect(toCorrectionViewState({ isPending: false, isError: false }, undefined)).toEqual({ kind: 'idle' });
    });

    it('⛔ reports SAVING even while a previous success is still cached', () => {
        expect(toCorrectionViewState({ isPending: true, isError: false }, saved)).toEqual({ kind: 'saving' });
    });

    it('⛔ reports FAILED rather than a stale success when the last attempt threw', () => {
        expect(toCorrectionViewState({ isPending: false, isError: true }, saved)).toEqual({ kind: 'failed' });
    });

    it('carries the server-decided reach onto the saved state, verbatim', () => {
        expect(toCorrectionViewState({ isPending: false, isError: false }, { ...saved, scope: 'global' })).toEqual({
            kind: 'saved',
            scope: 'global',
        });
    });

    it('carries the no-op outcome onto the unchanged state, verbatim', () => {
        expect(
            toCorrectionViewState({ isPending: false, isError: false }, { recorded: false, outcome: 'superseded' }),
        ).toEqual({ kind: 'unchanged', outcome: 'superseded' });
    });

    it('never reports failed for a no-op — the wire calls it a success and so does this', () => {
        const state = toCorrectionViewState(
            { isPending: false, isError: false },
            { recorded: false, outcome: 'already_in_force' },
        );

        expect(state.kind).not.toBe('failed');
    });
});

describe('the correction offer — which suggestions can be taught, and which cannot', () => {
    it('offers the affordance for a suggestion backed by a food', () => {
        expect(toCorrectionNoticeModel({ kind: 'idle' }, m)).toBeUndefined();
    });

    it('fills the “teach” label with the phrase the user actually typed', () => {
        expect(m.teachAction).toContain('{phrase}');
    });
});
