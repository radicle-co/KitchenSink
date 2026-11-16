import { describe, expect, it } from 'vitest';

import { KEPT_RECORD_VERSION, keptKeyFor, parseKeptDocument, serializeKeptDocument } from '../keptRecord.js';

import { iso, makeCooking, makeDoc, makePage, makeTimer, T0, timerId } from './keptFixtures.js';

describe('keptKeyFor', () => {
    it('is the per-user key of ADR 0004 condition 3', () => {
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
        [
            'an entry with an unknown key',
            JSON.stringify(makeDoc({ entries: { r1: { ...makeCooking(), note: 'x' } as never } })),
        ],
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
                makeTimer({ id: timerId(2), state: 'endedAway', endedAt: iso(T0), announcedAt: iso(T0), ordinal: 3 }),
            ],
        ]) {
            const doc = makeDoc({ entries: { r1: makeCooking(), r2: makePage({ servings: 4 }) }, timers });
            const parsed = ok(serializeKeptDocument(doc));

            expect(parsed.doc).toEqual(doc);
            expect(parsed.droppedTimerIds).toEqual([]);
        }
    });

    it('accepts a timer with no announcedAt and no ordinal', () => {
        const { ordinal: _ordinal, ...bare } = makeTimer();

        expect(ok(JSON.stringify(makeDoc({ timers: [bare as never] }))).doc.timers).toHaveLength(1);
    });

    it('drops a timer with no stepDigest, keeps the document and the others (B1)', () => {
        const { stepDigest: _digest, ...bad } = makeTimer({ id: timerId(1) });
        const good = makeTimer({ id: timerId(2) });
        const parsed = ok(JSON.stringify(makeDoc({ timers: [bad as never, good] })));

        expect(parsed.doc.timers).toEqual([good]);
        expect(parsed.droppedTimerIds).toEqual([timerId(1)]);
    });

    it('drops a timer that carries a label (R8a: no typed label is ever stored)', () => {
        const labelled = { ...makeTimer(), label: 'pasta' };
        const parsed = ok(JSON.stringify(makeDoc({ timers: [labelled as never] })));

        expect(parsed.doc.timers).toEqual([]);
        expect(parsed.droppedTimerIds).toEqual([timerId(1)]);
    });

    it('drops a timer whose id is not a UUIDv7', () => {
        const parsed = ok(JSON.stringify(makeDoc({ timers: [makeTimer({ id: 'abc' })] })));

        expect(parsed.doc.timers).toEqual([]);
    });

    it('keeps the first of two timers with one id and drops the rest (qse-r2 3)', () => {
        const first = makeTimer({ ordinal: 1 });
        const second = makeTimer({ ordinal: 2 });
        const parsed = ok(JSON.stringify(makeDoc({ timers: [first, second] })));

        expect(parsed.doc.timers).toEqual([first]);
        expect(parsed.droppedTimerIds).toEqual([timerId(1)]);
    });

    it('drops an unreadable timer without an id and still parses the document', () => {
        const parsed = ok(JSON.stringify(makeDoc({ timers: [42 as never, makeTimer()] })));

        expect(parsed.doc.timers).toHaveLength(1);
        expect(parsed.droppedTimerIds).toEqual([]);
    });
});
