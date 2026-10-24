/**
 * The words a byline renders, from the one copy table (plan 2026-10-15-010 D11). Each piece of user text is wrapped
 * in a Unicode isolate (FSI … PDI), so a right-to-left display name cannot pull the "@handle" or the parentheses
 * around it out of order.
 */
import { describe, expect, it } from 'vitest';

import { bylineMessages } from '../messages.js';
import { bylineText, isolate } from '../bylineText.js';

const copy = bylineMessages.en;

describe('bylineText', () => {
    it('reads "@handle (Name)" for a person with a display name', () => {
        expect(
            bylineText({ kind: 'person', username: 'braise', displayName: 'Eliza Moreno' }, copy, 'standalone'),
        ).toBe(`${isolate('@braise')} (${isolate('Eliza Moreno')})`);
    });

    it('reads "@handle" alone when there is no display name', () => {
        expect(bylineText({ kind: 'person', username: 'braise' }, copy, 'sentence')).toBe(isolate('@braise'));
    });

    it('reads the display name alone, without an "@", for a name-only byline', () => {
        expect(bylineText({ kind: 'name', displayName: 'Eliza Moreno' }, copy, 'standalone')).toBe(
            isolate('Eliza Moreno'),
        );
    });

    it('says "Former member" standing alone and "a former member" inside a sentence', () => {
        expect(bylineText({ kind: 'former' }, copy, 'standalone')).toBe('Former member');
        expect(bylineText({ kind: 'former' }, copy, 'sentence')).toBe('a former member');
    });

    it('renders nothing for a source or an empty byline — those surfaces say their own thing', () => {
        expect(bylineText({ kind: 'source', attribution: 'Serious Eats' }, copy, 'standalone')).toBeUndefined();
        expect(bylineText({ kind: 'none' }, copy, 'sentence')).toBeUndefined();
    });
});

describe('isolate', () => {
    it('wraps text in FIRST STRONG ISOLATE and POP DIRECTIONAL ISOLATE', () => {
        expect(isolate('محمد')).toBe('⁨محمد⁩');
    });
});
