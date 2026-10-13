/**
 * E8 (build spec §7.8): "Recipe published." after a publish, "Changes saved." after Save changes. The editor hands the
 * outcome to the host; web carries it to the detail page in a one-shot query parameter, native shows the snackbar
 * itself. This is the one place the three outcomes, their wire spelling and their words are defined.
 */
import { describe, expect, it } from 'vitest';

import { editorMessages } from '../messages.js';
import { finishedNoticeOf, outcomeOfExit, parseFinishedOutcome } from '../finishedOutcome.js';

const m = editorMessages.en;

describe('outcomeOfExit', () => {
    it('names a first publish, a later publish and Save changes', () => {
        const recipe = {} as never;

        expect(outcomeOfExit({ kind: 'published', recipe, firstPublish: true })).toBe('firstPublish');
        expect(outcomeOfExit({ kind: 'published', recipe, firstPublish: false })).toBe('published');
        expect(outcomeOfExit({ kind: 'changesSaved', recipe })).toBe('changesSaved');
    });
});

describe('finishedNoticeOf', () => {
    it('says "Recipe published." for both publishes and "Changes saved." for a save', () => {
        expect(finishedNoticeOf('firstPublish', m)).toBe('Recipe published.');
        expect(finishedNoticeOf('published', m)).toBe('Recipe published.');
        expect(finishedNoticeOf('changesSaved', m)).toBe('Changes saved.');
    });
});

describe('parseFinishedOutcome', () => {
    it.each(['firstPublish', 'published', 'changesSaved'] as const)('reads %s back', (outcome) => {
        expect(parseFinishedOutcome(outcome)).toBe(outcome);
    });

    it.each([null, undefined, '', 'nope', 'FIRSTPUBLISH', '__proto__', 'constructor'])(
        '⛔ reads %j as nothing: a URL is the reader`s to forge',
        (value) => {
            expect(parseFinishedOutcome(value)).toBeUndefined();
        },
    );
});
