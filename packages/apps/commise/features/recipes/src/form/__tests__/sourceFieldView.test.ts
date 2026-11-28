/**
 * The one rule both Source row leaves read (`sourceFieldViewOf`): which facts and words each row kind draws.
 */
import { describe, expect, it } from 'vitest';

import { recipeActionMessages } from '../../actions/messages.js';
import { editorMessages } from '../../editor/messages.js';
import { sourceFieldViewOf } from '../sourceFieldView.js';
import type { SourceRowModel } from '../sourceLink.js';

const m = editorMessages.en.source;
const answers = recipeActionMessages.en.sourceStatement;
const viewOf = (row: SourceRowModel): ReturnType<typeof sourceFieldViewOf> => sourceFieldViewOf(row, m, answers);

describe('sourceFieldViewOf', () => {
    it('draws nothing for a hidden row', () => {
        expect(viewOf({ kind: 'hidden' })).toEqual({ kind: 'hidden' });
    });

    it('says "I wrote this" for the own row', () => {
        expect(viewOf({ kind: 'own' })).toEqual({ kind: 'own', answer: answers.answerAuthored });
    });

    it('names an open book and keeps its title only when it has one', () => {
        expect(viewOf({ kind: 'openAnswered', answer: 'book', citation: 'Joy of Cooking' })).toEqual({
            kind: 'openAnswered',
            answer: answers.answerBook,
            citation: 'Joy of Cooking',
        });
        expect(viewOf({ kind: 'openAnswered', answer: 'book', citation: '' })).toEqual({
            kind: 'openAnswered',
            answer: answers.answerBook,
        });
    });

    it('passes a locked web source through', () => {
        expect(viewOf({ kind: 'locked', site: 'example.com', url: 'https://example.com/a' })).toEqual({
            kind: 'locked',
            site: 'example.com',
            url: 'https://example.com/a',
        });
    });

    it('keeps a locked answer and its citation only when each is there', () => {
        expect(viewOf({ kind: 'lockedAnswer', answer: 'paidSite', citation: 'Cook’s Illustrated' })).toEqual({
            kind: 'lockedAnswer',
            answer: answers.answerPaidSite,
            citation: 'Cook’s Illustrated',
        });
        expect(viewOf({ kind: 'lockedAnswer', answer: 'fromPerson', citation: '' })).toEqual({
            kind: 'lockedAnswer',
            answer: answers.answerPerson,
        });
        expect(viewOf({ kind: 'lockedAnswer' })).toEqual({ kind: 'lockedAnswer' });
    });

    describe('the field', () => {
        it('an empty row shows the hint with no note, warning or error', () => {
            expect(viewOf({ kind: 'empty', text: '' })).toEqual({
                kind: 'field',
                text: '',
                status: m.hint,
                pasted: false,
            });
        });

        it('a filled row shows its site, and warns that publishing locks it', () => {
            expect(viewOf({ kind: 'filled', text: 'https://a.com/x', site: 'a.com', fromPaste: false })).toEqual({
                kind: 'field',
                text: 'https://a.com/x',
                status: m.rightsLabel.replace('{site}', 'a.com'),
                pasted: false,
                warning: m.lockWarning,
            });
        });

        it('a filled row on a confirmed answer warns that the next save locks it, and a paste adds its note', () => {
            expect(
                viewOf({ kind: 'filled', text: 'https://a.com/x', site: 'a.com', fromPaste: true, confirmed: true }),
            ).toMatchObject({ pasted: true, warning: m.lockWarningSave });
        });

        it('an unusable address and a Commise link each carry their own error', () => {
            expect(viewOf({ kind: 'invalid', text: 'nope' })).toMatchObject({ error: m.invalid, status: m.hint });
            expect(viewOf({ kind: 'ownSite', text: 'https://commise.app/r' })).toMatchObject({
                error: m.ownSite,
                status: m.hint,
            });
        });
    });
});
