/**
 * Unit tests for `pasteMatchSession.ts`: the in-memory overlay of ONE paste's matching (ADR-0057: the device-draft format
 * is a one-way door and does not record the job, so who bound a line, which lines joined the draft, and what is expanded
 * live here and nowhere persistent). Seen red first.
 *
 * Each case is a rule the host depends on: a removed line is never joined again, a line that is not in the draft cannot
 * be bound or expanded, and a new job starts clean.
 */
import { describe, expect, it } from 'vitest';

import type { LineBinding } from '../../ingredientMatching/matchLine.js';
import {
    draftKeyOf,
    emptyPasteMatchSession,
    joinStateOf,
    reducePasteMatchSession,
    type PasteMatchEvent,
    type PasteMatchSession,
} from '../pasteMatchSession.js';

const COOK: LineBinding = {
    boundBy: 'cook',
    pick: { kind: 'food', foodId: 'oat', name: 'Oat milk' },
    reviewNote: undefined,
};
const SERVER: LineBinding = { boundBy: 'server', pick: { kind: 'food', foodId: 'whole', name: 'Whole milk' } };

const run = (...events: PasteMatchEvent[]): PasteMatchSession =>
    events.reduce(reducePasteMatchSession, emptyPasteMatchSession);

const ACCEPTED: PasteMatchEvent = { type: 'jobAccepted', jobId: 'job-1' };
const JOINED_MILK: PasteMatchEvent = { type: 'lineJoined', key: '0:0', draftKey: 'd-1' };

describe('jobAccepted', () => {
    it('starts a session for the job', () => {
        expect(run(ACCEPTED).jobId).toBe('job-1');
    });

    it('is idempotent for the same job: nothing the cook did is lost', () => {
        const session = run(ACCEPTED, JOINED_MILK, { type: 'bindingSet', key: '0:0', binding: COOK });

        expect(reducePasteMatchSession(session, ACCEPTED)).toBe(session);
    });

    it('a NEW job starts clean: its keys (lineIndex:foodIndex) would collide with the old job’s', () => {
        const session = run(ACCEPTED, JOINED_MILK, { type: 'bindingSet', key: '0:0', binding: COOK });
        const next = reducePasteMatchSession(session, { type: 'jobAccepted', jobId: 'job-2' });

        expect(next).toEqual({ ...emptyPasteMatchSession, jobId: 'job-2' });
    });
});

describe('lineJoined and lineJoinFailed', () => {
    it('records the draft key the food joined as', () => {
        const session = run(ACCEPTED, JOINED_MILK);

        expect(joinStateOf(session, '0:0')).toEqual({ status: 'joined', draftKey: 'd-1' });
        expect(draftKeyOf(session, '0:0')).toBe('d-1');
    });

    it('records a failed join, which a later successful retry replaces', () => {
        const failed = run(ACCEPTED, { type: 'lineJoinFailed', key: '0:0' });

        expect(joinStateOf(failed, '0:0')).toEqual({ status: 'joinFailed' });
        expect(draftKeyOf(failed, '0:0')).toBeUndefined();
        expect(joinStateOf(reducePasteMatchSession(failed, JOINED_MILK), '0:0')).toEqual({
            status: 'joined',
            draftKey: 'd-1',
        });
    });

    it('a failure never overwrites a food that already joined', () => {
        const session = run(ACCEPTED, JOINED_MILK);

        expect(reducePasteMatchSession(session, { type: 'lineJoinFailed', key: '0:0' })).toBe(session);
    });

    it('a second join of the same food is ignored: the first draft line stands', () => {
        const session = run(ACCEPTED, JOINED_MILK);

        expect(reducePasteMatchSession(session, { type: 'lineJoined', key: '0:0', draftKey: 'd-9' })).toBe(session);
    });

    it('a food the cook removed is never joined again', () => {
        const removed = run(ACCEPTED, JOINED_MILK, { type: 'draftLineRemoved', draftKey: 'd-1' });

        expect(reducePasteMatchSession(removed, { type: 'lineJoined', key: '0:0', draftKey: 'd-2' })).toBe(removed);
        expect(reducePasteMatchSession(removed, { type: 'lineJoinFailed', key: '0:0' })).toBe(removed);
    });

    it('a food with no entry has no join state', () => {
        expect(joinStateOf(run(ACCEPTED), '0:0')).toBeUndefined();
    });
});

describe('bindingSet', () => {
    it('holds who bound a joined line', () => {
        const session = run(ACCEPTED, JOINED_MILK, { type: 'bindingSet', key: '0:0', binding: SERVER });

        expect(session.bindings.get('0:0')).toEqual(SERVER);
    });

    it('a later binding replaces the earlier one (the cook changes a server pick)', () => {
        const session = run(
            ACCEPTED,
            JOINED_MILK,
            { type: 'bindingSet', key: '0:0', binding: SERVER },
            { type: 'bindingSet', key: '0:0', binding: COOK },
        );

        expect(session.bindings.get('0:0')).toEqual(COOK);
    });

    it('is refused for a food that is not in the draft: there is no line to bind', () => {
        const session = run(ACCEPTED);

        expect(reducePasteMatchSession(session, { type: 'bindingSet', key: '0:0', binding: COOK })).toBe(session);
    });
});

describe('draftLineRemoved', () => {
    it('marks the food removed, drops its binding, and clears the expanded and pane lines it held', () => {
        const session = run(
            ACCEPTED,
            JOINED_MILK,
            { type: 'lineJoined', key: '1:0', draftKey: 'd-2' },
            { type: 'bindingSet', key: '0:0', binding: COOK },
            { type: 'expanded', key: '0:0' },
            { type: 'paneMoved', key: '0:0' },
            { type: 'draftLineRemoved', draftKey: 'd-1' },
        );

        expect(joinStateOf(session, '0:0')).toEqual({ status: 'removed' });
        expect(session.bindings.has('0:0')).toBe(false);
        expect(session.expanded).toBeUndefined();
        expect(session.paneKey).toBeUndefined();
        expect(joinStateOf(session, '1:0')).toEqual({ status: 'joined', draftKey: 'd-2' });
    });

    it('leaves the expanded and pane lines alone when another line is removed', () => {
        const session = run(
            ACCEPTED,
            JOINED_MILK,
            { type: 'lineJoined', key: '1:0', draftKey: 'd-2' },
            { type: 'expanded', key: '1:0' },
            { type: 'paneMoved', key: '1:0' },
            { type: 'draftLineRemoved', draftKey: 'd-1' },
        );

        expect(session.expanded).toBe('1:0');
        expect(session.paneKey).toBe('1:0');
    });

    it('a draft key the overlay does not own is ignored (an ordinary typed row)', () => {
        const session = run(ACCEPTED, JOINED_MILK);

        expect(reducePasteMatchSession(session, { type: 'draftLineRemoved', draftKey: 'typed' })).toBe(session);
    });
});

describe('expanded and paneMoved', () => {
    it('hold the line the list has open and the line the pane shows, and undefined closes them', () => {
        const open = run(ACCEPTED, JOINED_MILK, { type: 'expanded', key: '0:0' }, { type: 'paneMoved', key: '0:0' });

        expect(open.expanded).toBe('0:0');
        expect(open.paneKey).toBe('0:0');

        const closed = run(
            ACCEPTED,
            JOINED_MILK,
            { type: 'expanded', key: '0:0' },
            { type: 'expanded', key: undefined },
            { type: 'paneMoved', key: '0:0' },
            { type: 'paneMoved', key: undefined },
        );

        expect(closed.expanded).toBeUndefined();
        expect(closed.paneKey).toBeUndefined();
    });

    it('refuse a food that is not in the draft', () => {
        const session = run(ACCEPTED);

        expect(reducePasteMatchSession(session, { type: 'expanded', key: '0:0' })).toBe(session);
        expect(reducePasteMatchSession(session, { type: 'paneMoved', key: '0:0' })).toBe(session);
    });

    it('return the same session when nothing moved', () => {
        const session = run(ACCEPTED, JOINED_MILK, { type: 'expanded', key: '0:0' });

        expect(reducePasteMatchSession(session, { type: 'expanded', key: '0:0' })).toBe(session);
    });
});
