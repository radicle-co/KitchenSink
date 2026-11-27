/**
 * E8 (build spec §7.8): "Recipe published." after a publish, "Changes saved." after Save changes. The editor hands the
 * finish to the host, which shows the snackbar before it navigates. Only a refused Private travels to the recipe page,
 * in one query parameter. This is the one place the outcomes and their words are defined.
 *
 * REWRITTEN for the removal of the address-borne notice: the `done` parameter and its reader are gone, so their rows
 * are replaced by the table for `parsePrivateRefusalParam`, which reads the one parameter that is left.
 *
 * REWRITTEN for the stuck-save defect: a finish also says whether the cook's Private was refused (`privateRefusalOf`).
 * REWRITTEN AGAIN (buildSpec §6.4, plan 2026-10-14-009 T3): the refusal is no longer said by the snackbar. The recipe
 * page says it inline (`visibilityNoticeOf`), so the snackbar keeps only how the editor finished.
 */
import { describe, expect, it } from 'vitest';

import { editorMessages } from '../messages.js';
import {
    finishedNoticeOf,
    outcomeOfExit,
    parsePrivateRefusalParam,
    PRIVATE_REFUSED_PARAM,
} from '../finishedOutcome.js';

const m = editorMessages.en;
const OUTCOMES = ['firstPublish', 'published', 'changesSaved'] as const;

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

    it.each(
        OUTCOMES.flatMap((outcome) =>
            (['final', 'premium', 'slots'] as const).map((refusal) => [outcome, refusal] as const),
        ),
    )(
        '⛔ ignores a refusal: %s with %s still says how the editor finished (the page says the refusal inline)',
        (outcome, privateRefused) => {
            expect(finishedNoticeOf({ outcome, privateRefused }, m)).toBe(
                finishedNoticeOf({ outcome, privateRefused: undefined }, m),
            );
            expect(finishedNoticeOf({ outcome, privateRefused }, m)).toMatch(/^(Recipe published|Changes saved)\.$/u);
        },
    );
});

describe('parsePrivateRefusalParam', () => {
    it.each(['final', 'premium', 'slots'] as const)('reads the exact spelling %s', (refusal) => {
        expect(parsePrivateRefusalParam(refusal)).toBe(refusal);
    });

    it.each([
        null,
        undefined,
        '',
        'nope',
        'PUBLISHED',
        'FINAL',
        'final ',
        ' final',
        'final.slots',
        '__proto__',
        'constructor',
    ])('⛔ reads %j as nothing: a URL is the reader`s to forge', (value) => {
        expect(parsePrivateRefusalParam(value)).toBeUndefined();
    });

    it('names the one query parameter that carries the refusal', () => {
        expect(PRIVATE_REFUSED_PARAM).toBe('privateRefused');
    });
});
