/**
 * The `?ids=` canonicalization (plan U8).
 *
 * The URL IS the cache key (ADR-0020 keys food's distribution on the URL alone), so these are not
 * string-tidying tests: an unstable ordering means two callers asking for the same foods occupy two cache
 * entries and neither ever hits, which looks exactly like "the CDN isn't helping" and nothing else.
 */
import { describe, it, expect } from 'vitest';

import {
    MAX_NUTRITION_IDS,
    canonicalNutritionQuery,
    canonicalizeNutritionIds,
    isNutritionIdListError,
} from '../../foods.schema.js';

describe('canonicalizeNutritionIds', () => {
    it('⛔ produces the SAME list regardless of the order the caller asked in', () => {
        expect(canonicalizeNutritionIds('b,a,c')).toEqual(canonicalizeNutritionIds('c,b,a'));
    });

    it('⛔ deduplicates, so a repeated id cannot fork the cache key', () => {
        expect(canonicalizeNutritionIds('a,b,a')).toEqual(['a', 'b']);
    });

    it('trims whitespace and drops empty entries', () => {
        expect(canonicalizeNutritionIds(' a , ,b ,')).toEqual(['a', 'b']);
    });

    it('rejects an empty list rather than answering for zero foods', () => {
        expect(() => canonicalizeNutritionIds('')).toThrow(/at least one/);
        expect(() => canonicalizeNutritionIds(undefined)).toThrow(/at least one/);
        expect(() => canonicalizeNutritionIds(' , , ')).toThrow(/at least one/);
    });

    it('⛔ rejects a list over the cap — the unbounded-read vector', () => {
        // Without a cap one URL names unbounded ids and becomes an unbounded database read.
        const over = Array.from({ length: MAX_NUTRITION_IDS + 1 }, (_, i) => `id${i}`).join(',');

        expect(() => canonicalizeNutritionIds(over)).toThrow(/exceeds/);
    });

    it('counts DISTINCT ids against the cap, so duplicates cannot be used to smuggle past it', () => {
        const atCap = Array.from({ length: MAX_NUTRITION_IDS }, (_, i) => `id${i}`);

        expect(() => canonicalizeNutritionIds([...atCap, ...atCap].join(','))).not.toThrow();
    });

    it('throws a typed error its guard recognises', () => {
        try {
            canonicalizeNutritionIds('');
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(isNutritionIdListError(error)).toBe(true);
        }
    });
});

describe('canonicalNutritionQuery', () => {
    it('builds the exact query string the server considers canonical', () => {
        expect(canonicalNutritionQuery(['c', 'a', 'b'])).toBe('ids=a,b,c');
    });

    it('gives two callers requesting the same set a byte-identical query', () => {
        expect(canonicalNutritionQuery(['x', 'y'])).toBe(canonicalNutritionQuery(['y', 'x', 'y']));
    });
});
