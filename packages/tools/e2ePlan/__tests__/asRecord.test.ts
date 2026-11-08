import { describe, expect, it } from 'vitest';

import { asRecord } from '../src/asRecord.js';

describe('asRecord', () => {
    it('returns an object as it is', () => {
        const value = { a: 1 };

        expect(asRecord(value)).toBe(value);
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['an array, which has keys but is not a record', ['a']],
        ['a string', 'text'],
        ['a number', 7],
    ])('returns an empty record for %s', (_name, value) => {
        expect(asRecord(value)).toEqual({});
    });
});
