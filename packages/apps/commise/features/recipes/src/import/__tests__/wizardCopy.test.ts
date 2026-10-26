/**
 * Unit tests for the wizard's copy (`wizardCopy.ts`): the progress line both leaves draw and the words of Save and
 * leave.
 *
 * REWRITTEN for review finding M2 (import) and the design authority's count rule: the progress line counts only
 * default, needsChoice and noMatch lines as "to choose", and a checking line on its own ("· 1 being checked"), each
 * part a plural with a no-break space before its dot; "You reviewed …" is a plural, so one recipe reads "1 recipe";
 * Save and leave states the ONE bulk rule (`import.saveAsWritten.rule`) the mode choice states. Every count-bearing
 * template has its count-1 case here.
 */
import { describe, expect, it } from 'vitest';

import { importMessages } from '../messages.js';
import { backTargetOf, leaveCopyOf, progressTextOf } from '../wizardCopy.js';

const w = importMessages.en.wizard;
const l = importMessages.en.leave;
const RULE =
    'Matched foods and the usual defaults are set, and each default keeps its Default tag. Every other line is saved as written, with no food, for you to choose later.';

// REWRITTEN for U15 (the newest doc, commit 7b62777fc): "{choose} to choose", it was "{n} lines to choose".
describe('progressTextOf', () => {
    it.each([
        [3, 0, 'Recipe 14 of 309 · 3 to choose'],
        [1, 0, 'Recipe 14 of 309 · 1 to choose'],
        [2, 1, 'Recipe 14 of 309 · 2 to choose · 1 being checked'],
        [0, 1, 'Recipe 14 of 309 · 1 being checked'],
        [0, 2, 'Recipe 14 of 309 · 2 being checked'],
        [0, 0, 'Recipe 14 of 309'],
    ])('%d to choose, %d being checked', (openLines, checkingLines, text) => {
        expect(progressTextOf({ position: 14, total: 309, openLines, checkingLines }, w, 'en')).toBe(text);
    });
});

describe('backTargetOf', () => {
    it('is the recipe before, and undefined on the first', () => {
        expect(backTargetOf(14)).toBe(13);
        expect(backTargetOf(1)).toBeUndefined();
    });
});

describe('leaveCopyOf', () => {
    it('says how many were reviewed, how many are saved now, the bulk rule, and where the review resumes', () => {
        expect(
            leaveCopyOf({ reviewed: 14, total: 309, resumeAt: 15 }, l, importMessages.en.saveAsWritten, 'en'),
        ).toEqual({
            reviewed: 'You reviewed 14 of 309 recipes.',
            rest: 'The other 295 are saved now.',
            rule: RULE,
            resume: 'They wait under “To review” in My recipes, and you can pick up at recipe 15.',
        });
    });

    it('one recipe in all reads "1 recipe"', () => {
        expect(
            leaveCopyOf({ reviewed: 0, total: 1, resumeAt: 1 }, l, importMessages.en.saveAsWritten, 'en').reviewed,
        ).toBe('You reviewed 0 of 1 recipe.');
    });

    it('uses the singular for one recipe left, and never counts below zero', () => {
        expect(
            leaveCopyOf({ reviewed: 308, total: 309, resumeAt: 309 }, l, importMessages.en.saveAsWritten, 'en').rest,
        ).toBe('The other 1 is saved now.');
        expect(
            leaveCopyOf({ reviewed: 320, total: 309, resumeAt: 309 }, l, importMessages.en.saveAsWritten, 'en').rest,
        ).toBe('The other 0 are saved now.');
    });

    it('⛔ states the same rule sentence the mode choice states, from the one key', () => {
        expect(leaveCopyOf({ reviewed: 1, total: 2, resumeAt: 2 }, l, importMessages.en.saveAsWritten, 'en').rule).toBe(
            importMessages.en.saveAsWritten.rule,
        );
        expect(importMessages.en.saveAsWritten.rule).toBe(RULE);
    });
});
