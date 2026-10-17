import { describe, expect, it } from 'vitest';

import { PHONE_VIEWPORT } from '../phoneSize.js';
import { phoneMatches } from '../phoneMediaQuery.js';

const browserSaysNo = (): boolean => false;

describe('phoneMatches', () => {
    it('describes the phone as 390 x 844', () => {
        expect(PHONE_VIEWPORT).toEqual({ width: 390, height: 844 });
    });

    it.each<[string, boolean]>([
        ['(max-width: 767px)', true],
        ['(max-width: 390px)', true],
        ['(max-width: 389px)', false],
        ['(min-width: 768px)', false],
        ['(min-width: 390px)', true],
        ['(min-width: 391px)', false],
        ['(width: 390px)', true],
        ['(width: 391px)', false],
        ['(min-height: 800px)', true],
        ['(min-height: 845px)', false],
        ['(max-height: 844px)', true],
        ['(max-height: 843px)', false],
        ['(min-width: 640px) and (max-width: 900px)', false],
        ['(min-width: 300px) and (max-width: 900px)', true],
        ['(max-width: 100px), (min-width: 300px)', true],
        ['(max-width: 100px), (min-width: 500px)', false],
        ['(orientation: portrait)', true],
        ['(orientation: landscape)', false],
        ['(max-width: 40em)', true],
        ['(max-width: 24rem)', false],
        ['  ( min-width : 390px )  ', true],
    ])('answers %s with the phone: %s', (query, expected) => {
        expect(phoneMatches(query, browserSaysNo)).toBe(expected);
    });

    it.each<[string, string[]]>([
        ['(prefers-reduced-motion: reduce)', ['(prefers-reduced-motion: reduce)']],
        ['(min-width: 100px) and (hover: hover)', ['(min-width: 100px) and (hover: hover)']],
        ['(max-width: 10px), (hover: hover)', ['(hover: hover)']],
        ['(min-width: 10vw)', ['(min-width: 10vw)']],
    ])('hands a term that is not purely about the viewport to the browser: %s', (query, asked) => {
        const seen: string[] = [];

        phoneMatches(query, (term) => {
            seen.push(term.trim());

            return false;
        });

        expect(seen).toEqual(asked);
    });

    it('uses the browser answer for such a term', () => {
        expect(phoneMatches('(hover: hover)', () => true)).toBe(true);
        expect(phoneMatches('(hover: hover)', () => false)).toBe(false);
    });
});
