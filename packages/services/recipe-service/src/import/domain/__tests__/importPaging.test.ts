/**
 * The opaque cursors of the paged lists. A cursor is the client's to hold and never to build; a hostile or stale one is a
 * `400`, not a `500` from a bad SQL parameter.
 */
import { describe, expect, it } from 'vitest';

import { decodeImportListCursor, decodeLineCursor, encodeImportListCursor, encodeLineCursor } from '../importPaging.js';

describe('the line cursor (flagged and to-check)', () => {
    it('round-trips a position', () => {
        const cursor = { ordinal: 7, lineIndex: 3, foodIndex: 1 };

        expect(decodeLineCursor(encodeLineCursor(cursor))).toStrictEqual(cursor);
    });

    it('is opaque: not the plain position', () => {
        expect(encodeLineCursor({ ordinal: 7, lineIndex: 3, foodIndex: 1 })).not.toContain('7');
    });

    it.each([
        '',
        'not base64 !!',
        'e30',
        Buffer.from('{"o":-1,"l":0,"f":0}').toString('base64url'),
        Buffer.from('{"o":1.5,"l":0,"f":0}').toString('base64url'),
        Buffer.from('[1,2,3]').toString('base64url'),
    ])('refuses %j', (garbage) => {
        expect(decodeLineCursor(garbage)).toBeUndefined();
    });

    it('refuses an ordinal past int4 (it would be a 22003 in SQL)', () => {
        expect(
            decodeLineCursor(Buffer.from(JSON.stringify({ o: 2_147_483_648, l: 0, f: 0 })).toString('base64url')),
        ).toBeUndefined();
    });
});

describe('the import list cursor', () => {
    const cursor = { createdAt: '2026-10-26T12:00:00.000Z', id: '66666666-6666-4666-8666-000000000001' };

    it('round-trips', () => {
        expect(decodeImportListCursor(encodeImportListCursor(cursor))).toStrictEqual(cursor);
    });

    it.each(['', 'nope', Buffer.from('{"c":"yesterday","i":"x"}').toString('base64url')])('refuses %j', (garbage) => {
        expect(decodeImportListCursor(garbage)).toBeUndefined();
    });
});
