import { MAX_TIMER_MS, MIN_TIMER_MS } from '@kitchensink/cooking-core';
import { describe, expect, it } from 'vitest';

import { KEPT_RECORD_VERSION, keptKeyFor, parseKeptDocument, serializeKeptDocument } from '../keptRecord.js';

import {
    iso,
    makeCooking,
    makeDoc,
    makeEnded,
    makePage,
    makePaused,
    makeTimer,
    rawKeptDocument,
    T0,
    timerId,
} from '../__fixtures__/keptFixtures.js';

describe('keptKeyFor', () => {
    it('is the per-user key of ADR-0094 section 8, condition 3', () => {
        expect(keptKeyFor('user_1')).toBe('cook.v2.user_1');
        expect(KEPT_RECORD_VERSION).toBe(1);
    });
});

describe('parseKeptDocument', () => {
    const ok = (raw: string) => {
        const parsed = parseKeptDocument(raw);

        if (parsed.kind !== 'ok') {
            throw new Error(`expected ok, got ${parsed.kind}`);
        }

        return parsed;
    };

    it('reads null as absent', () => {
        expect(parseKeptDocument(null)).toEqual({ kind: 'absent' });
    });

    it.each([
        ['not JSON', '{nope'],
        ['a JSON array', '[]'],
        ['the wrong version', JSON.stringify({ ...makeDoc(), v: 2 })],
        ['an unknown document key', JSON.stringify({ ...makeDoc(), extra: 1 })],
        ['an entry with an unknown key', rawKeptDocument({ entries: { r1: { ...makeCooking(), note: 'x' } } })],
        ['an entry of an unknown kind', JSON.stringify({ ...makeDoc(), entries: { r1: { kind: 'other' } } })],
        ['a negative rev', JSON.stringify({ ...makeDoc(), rev: -1 })],
        ['a bad lastTouch', JSON.stringify(makeDoc({ entries: { r1: makePage({ lastTouch: 'yesterday' }) } }))],
    ])('reads %s as invalid (the store removes the key)', (_name, raw) => {
        expect(parseKeptDocument(raw)).toEqual({ kind: 'invalid' });
    });

    it('round-trips entries and zero, one and two timers, with announcedAt and ordinals 1 and 3', () => {
        for (const timers of [
            [],
            [makeTimer()],
            [
                makeTimer({ ordinal: 1 }),
                makePaused({ id: timerId(3) }),
                makeEnded('ringing', { id: timerId(4) }),
                makeEnded('endedAway', { id: timerId(2), announcedAt: iso(T0), ordinal: 3 }),
            ],
        ]) {
            const doc = makeDoc({ entries: { r1: makeCooking(), r2: makePage({ servings: 4 }) }, timers });
            const parsed = ok(serializeKeptDocument(doc));

            expect(parsed.doc).toEqual(doc);
            expect(parsed.droppedTimerIds).toEqual([]);
        }
    });

    it('accepts a timer with no announcedAt', () => {
        expect(ok(JSON.stringify(makeDoc({ timers: [makeEnded('endedAway')] }))).doc.timers).toHaveLength(1);
    });

    // v1 is a one-way door (ADR 0094 section 2): the reducer's `durationMs`, `run` and `ordinal` are required on every
    // state, so a timer that lacks one, or holds one the reducer could never hold, is dropped and reported.
    describe.each([
        ['a running timer', makeTimer],
        ['a paused timer', makePaused],
        ['a ringing timer', (over: object) => makeEnded('ringing', over)],
        ['an endedAway timer', (over: object) => makeEnded('endedAway', over)],
    ])('%s', (_state, make) => {
        it.each([
            ['no durationMs', { durationMs: undefined }],
            ['a durationMs below the reducer minimum', { durationMs: MIN_TIMER_MS - 1 }],
            ['a durationMs above the reducer maximum', { durationMs: MAX_TIMER_MS + 1 }],
            ['a durationMs that is not an integer', { durationMs: MIN_TIMER_MS + 0.5 }],
            ['no run', { run: undefined }],
            ['a run of 0', { run: 0 }],
            ['a run that is not an integer', { run: 1.5 }],
            ['no ordinal', { ordinal: undefined }],
            ['an ordinal of 0', { ordinal: 0 }],
            ['an ordinal that is not an integer', { ordinal: 1.5 }],
        ])('with %s is dropped and reported, beside a good timer and the entry', (_name, over) => {
            const good = makeTimer({ id: timerId(2) });
            const parsed = ok(
                rawKeptDocument({ entries: { r1: makeCooking() }, timers: [{ ...make({}), ...over }, good] }),
            );

            expect(parsed.doc.timers).toEqual([good]);
            expect(parsed.doc.entries['r1']).toEqual(makeCooking());
            expect(parsed.droppedTimerIds).toEqual([timerId(1)]);
        });

        it('keeps the bounds themselves, the first run and ordinal', () => {
            for (const durationMs of [MIN_TIMER_MS, MAX_TIMER_MS]) {
                expect(ok(JSON.stringify(makeDoc({ timers: [make({ durationMs })] }))).doc.timers).toHaveLength(1);
            }
        });
    });

    it('drops a timer with no stepDigest, keeps the document and the others', () => {
        const { stepDigest: _digest, ...bad } = makeTimer({ id: timerId(1) });
        const good = makeTimer({ id: timerId(2) });
        const parsed = ok(rawKeptDocument({ timers: [bad, good] }));

        expect(parsed.doc.timers).toEqual([good]);
        expect(parsed.droppedTimerIds).toEqual([timerId(1)]);
    });

    it.each([
        ['a running timer with no endsAt', { ...makeTimer(), endsAt: undefined }],
        ['a paused timer with no remainingMs', { ...makePaused(), remainingMs: undefined }],
        ['a paused timer with a negative remainingMs', { ...makePaused(), remainingMs: -1 }],
        ['a paused timer with no pausedAt', { ...makePaused(), pausedAt: undefined }],
        ['a paused timer that still has endsAt', { ...makePaused(), endsAt: iso(T0) }],
        ['a running timer that carries pausedAt', { ...makeTimer(), pausedAt: iso(T0) }],
        ['a ringing timer with no endedAt', { ...makeEnded('ringing'), endedAt: undefined }],
        ['an endedAway timer with no endedAt', { ...makeEnded('endedAway'), endedAt: undefined }],
        [
            'a ringing timer that still has endsAt (the end is endedAt alone)',
            { ...makeEnded('ringing'), endsAt: iso(T0) },
        ],
        ['an endedAway timer that still has endsAt', { ...makeEnded('endedAway'), endsAt: iso(T0) }],
        [
            'a ringing timer with announcedAt (only endedAway may carry announcedAt)',
            { ...makeEnded('ringing'), announcedAt: iso(T0) },
        ],
        ['a timer of an unknown state', { ...makeTimer(), state: 'frozen' }],
    ])('drops %s, beside one good timer', (_name, bad) => {
        const good = makeTimer({ id: timerId(2) });
        const parsed = ok(rawKeptDocument({ entries: { r1: makeCooking() }, timers: [bad, good] }));

        expect(parsed.doc.timers).toEqual([good]);
        expect(parsed.doc.entries['r1']).toEqual(makeCooking());
        expect(parsed.droppedTimerIds).toEqual([timerId(1)]);
    });

    it('drops a timer that carries a label (no typed label is ever stored)', () => {
        const labelled = { ...makeTimer(), label: 'pasta' };
        const parsed = ok(rawKeptDocument({ timers: [labelled] }));

        expect(parsed.doc.timers).toEqual([]);
        expect(parsed.droppedTimerIds).toEqual([timerId(1)]);
    });

    it('drops a timer whose id is not a UUIDv7', () => {
        const parsed = ok(JSON.stringify(makeDoc({ timers: [makeTimer({ id: 'abc' })] })));

        expect(parsed.doc.timers).toEqual([]);
    });

    it('keeps the first of two timers with one id and drops the rest ', () => {
        const first = makeTimer({ ordinal: 1 });
        const second = makeTimer({ ordinal: 2 });
        const parsed = ok(JSON.stringify(makeDoc({ timers: [first, second] })));

        expect(parsed.doc.timers).toEqual([first]);
        expect(parsed.droppedTimerIds).toEqual([timerId(1)]);
    });

    it('drops an unreadable timer without an id and still parses the document', () => {
        const parsed = ok(rawKeptDocument({ timers: [42, makeTimer()] }));

        expect(parsed.doc.timers).toHaveLength(1);
        expect(parsed.droppedTimerIds).toEqual([]);
    });
});
