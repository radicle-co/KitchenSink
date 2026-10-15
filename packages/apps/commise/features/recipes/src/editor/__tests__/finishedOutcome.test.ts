/**
 * E8 (build spec §7.8): "Recipe published." after a publish, "Changes saved." after Save changes. The editor hands the
 * finish to the host; web carries it to the detail page in a one-shot query parameter, native shows the snackbar
 * itself. This is the one place the outcomes, their wire spelling and their words are defined.
 *
 * REWRITTEN for the stuck-save defect: a finish also says whether the cook's Private was refused (`privateRefusalOf`), and
 * then the notice says the recipe stayed public in place of "Recipe published." / "Changes saved.".
 */
import { describe, expect, it } from 'vitest';

import { editorMessages } from '../messages.js';
import {
    finishedNoticeOf,
    finishedParamOf,
    outcomeOfExit,
    parseFinishedParam,
    type EditorFinish,
} from '../finishedOutcome.js';

const m = editorMessages.en;
const OUTCOMES = ['firstPublish', 'published', 'changesSaved'] as const;
const REFUSALS = [undefined, 'final', 'premium'] as const;

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
        expect(finishedNoticeOf({ outcome: 'firstPublish', privateRefused: undefined }, m)).toBe('Recipe published.');
        expect(finishedNoticeOf({ outcome: 'published', privateRefused: undefined }, m)).toBe('Recipe published.');
        expect(finishedNoticeOf({ outcome: 'changesSaved', privateRefused: undefined }, m)).toBe('Changes saved.');
    });

    it.each(OUTCOMES)('⛔ says the recipe stayed public when Private was refused (%s)', (outcome) => {
        expect(finishedNoticeOf({ outcome, privateRefused: 'final' }, m)).toBe(
            "This recipe is public. Your other changes are saved, but it couldn't be made private.",
        );
        expect(finishedNoticeOf({ outcome, privateRefused: 'premium' }, m)).toBe(
            'This recipe is public. Your other changes are saved, but private recipes are part of Premium.',
        );
    });
});

describe('finishedParamOf / parseFinishedParam', () => {
    it.each(OUTCOMES.flatMap((outcome) => REFUSALS.map((privateRefused) => [outcome, privateRefused] as const)))(
        'reads %s with refusal %s back',
        (outcome, privateRefused) => {
            const finish: EditorFinish = { outcome, privateRefused };

            expect(parseFinishedParam(finishedParamOf(finish))).toStrictEqual(finish);
        },
    );

    it('keeps the plain outcome spelling when nothing was refused', () => {
        expect(finishedParamOf({ outcome: 'published', privateRefused: undefined })).toBe('published');
        expect(finishedParamOf({ outcome: 'published', privateRefused: 'final' })).toBe('published.final');
    });

    it.each([
        null,
        undefined,
        '',
        'nope',
        'FIRSTPUBLISH',
        '__proto__',
        'constructor',
        'published.',
        'published.nope',
        'published.final.final',
        '.final',
        'final',
    ])('⛔ reads %j as nothing: a URL is the reader`s to forge', (value) => {
        expect(parseFinishedParam(value)).toBeUndefined();
    });
});
