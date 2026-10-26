/**
 * Unit tests for the wizard's copy (`wizardCopy.ts`): the progress line both leaves draw — the open-line count in the
 * right plural, dropped when nothing is left to choose — and the recipe Back returns to.
 */
import { describe, expect, it } from 'vitest';

import { importMessages } from '../messages.js';
import { backTargetOf, leaveCopyOf, progressTextOf } from '../wizardCopy.js';

const w = importMessages.en.wizard;
const l = importMessages.en.leave;

describe('progressTextOf', () => {
    it.each([
        [14, 309, 3, 'Recipe 14 of 309 · 3 lines to choose'],
        [14, 309, 1, 'Recipe 14 of 309 · 1 line to choose'],
        [14, 309, 0, 'Recipe 14 of 309'],
    ])('recipe %d of %d with %d open', (position, total, open, text) => {
        expect(progressTextOf({ position, total, openLines: open }, w, 'en')).toBe(text);
    });
});

describe('backTargetOf', () => {
    it('is the recipe before, and undefined on the first', () => {
        expect(backTargetOf(14)).toBe(13);
        expect(backTargetOf(1)).toBeUndefined();
    });
});

describe('leaveCopyOf', () => {
    it('says how many were reviewed, how many are saved now, and where the review resumes', () => {
        const copy = leaveCopyOf({ reviewed: 14, total: 309, resumeAt: 15 }, l, 'en');

        expect(copy.reviewed).toBe('You reviewed 14 of 309 recipes.');
        expect(copy.rest.startsWith('The other 295 are saved now.')).toBe(true);
        expect(copy.resume).toBe('They wait under “To review” in My recipes, and you can pick up at recipe 15.');
    });

    it('uses the singular for one recipe left, and never counts below zero', () => {
        expect(
            leaveCopyOf({ reviewed: 308, total: 309, resumeAt: 309 }, l, 'en').rest.startsWith('The other 1 is'),
        ).toBe(true);
        expect(
            leaveCopyOf({ reviewed: 320, total: 309, resumeAt: 309 }, l, 'en').rest.startsWith('The other 0 are'),
        ).toBe(true);
    });
});
