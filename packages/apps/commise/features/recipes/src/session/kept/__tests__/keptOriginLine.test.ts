/**
 * The origin of a stored timer is an object: an offer names the line that offered it (an index, `null` when unknown),
 * an added timer names nothing. The record is strict about it, so no line text and no stray key is ever stored.
 */
import { describe, expect, it } from 'vitest';

import { makeTimer, rawKeptDocument, timerId } from '../__fixtures__/keptFixtures.js';
import { keptTimerSchema, parseKeptDocument } from '../keptRecord.js';
import { activeTimerOf, keptTimerOf } from '../keptTimerAdapter.js';

const now = Date.parse('2026-11-20T10:00:00.000Z');

const dropped = (origin: unknown): readonly string[] => {
    const parsed = parseKeptDocument(
        rawKeptDocument({ timers: [{ ...makeTimer({ id: timerId(1) }), origin }, makeTimer({ id: timerId(2) })] }),
    );

    if (parsed.kind !== 'ok') {
        throw new Error('The document should have parsed.');
    }

    return parsed.droppedTimerIds;
};

describe('the stored origin', () => {
    it.each([
        ['an offer with a line', { kind: 'offer', lineIndex: 1 }],
        ['an offer whose line is not known', { kind: 'offer', lineIndex: null }],
        ['an added timer', { kind: 'added' }],
    ])('keeps %s as it was written', (_name, origin) => {
        const timer = { ...makeTimer(), origin };

        expect(keptTimerSchema.parse(timer)).toEqual(timer);
        expect(dropped(origin)).toEqual([]);
    });

    it.each([
        ['an added timer with a line', { kind: 'added', lineIndex: 0 }],
        ['an offer with no lineIndex', { kind: 'offer' }],
        ['an offer with a negative line', { kind: 'offer', lineIndex: -1 }],
        ['an offer with a fractional line', { kind: 'offer', lineIndex: 0.5 }],
        ['an offer with a line that is text', { kind: 'offer', lineIndex: 'Roast' }],
        ['an offer with line text beside the index', { kind: 'offer', lineIndex: 0, text: 'Roast 20 min' }],
        ['a kind outside the set', { kind: 'line', lineIndex: 0 }],
        ['the old string form', 'offer'],
    ])('drops a timer with %s, and keeps the good one', (_name, origin) => {
        expect(dropped(origin)).toEqual([timerId(1)]);
    });
});

describe('the adapter and the origin', () => {
    it.each([
        ['an offer with a line', { kind: 'offer', lineIndex: 2 }],
        ['an offer whose line is not known', { kind: 'offer', lineIndex: null }],
        ['an added timer', { kind: 'added' }],
    ] as const)('carries %s both ways', (_name, origin) => {
        const stored = makeTimer({ origin });

        expect(activeTimerOf(stored).origin).toEqual(origin);
        expect(keptTimerOf(activeTimerOf(stored), stored, now).origin).toEqual(origin);
    });
});
