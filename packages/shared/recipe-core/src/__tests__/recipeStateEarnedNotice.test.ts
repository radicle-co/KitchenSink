/**
 * VIEW_ADAPTED_BY_COOK's earned sentence is NOT a toast of its own (owner ruling relayed by Solar Squad). It is a second
 * sentence added after whichever outcome sentence applies: the save outcome or the publish outcome (AE16).
 */
import { describe, expect, it } from 'vitest';

import { noticeWithEarned } from '../recipeState/earnedNotice.js';

const EARNED_SENTENCE = 'This recipe is now marked Adapted by you.';

describe('noticeWithEarned', () => {
    it('adds the earned sentence after the save outcome, and says "Changes saved." once', () => {
        const notice = noticeWithEarned('Changes saved.', EARNED_SENTENCE);

        expect(notice).toBe(`Changes saved. ${EARNED_SENTENCE}`);
        expect(notice.split('Changes saved.').length - 1).toBe(1);
    });

    it('adds it after the publish outcome too', () => {
        expect(noticeWithEarned('Recipe published.', EARNED_SENTENCE)).toBe(`Recipe published. ${EARNED_SENTENCE}`);
    });

    it('leaves the outcome sentence alone when nothing was earned', () => {
        expect(noticeWithEarned('Changes saved.', undefined)).toBe('Changes saved.');
    });
});
