/**
 * THE source-statement sheet's pure core: when the cook is asked where a recipe is from, which answers the surface offers, what
 * each answer writes, and the sheet's own state. Written from the spec before `sourceStatement.ts` existed.
 *
 * The rows a mutant must not survive:
 *  1. The ask is `statementRequiredOf`'s answer and nobody else's: a typed recipe, a source already stated and an answered
 *     session are never asked, and `publicNeedsStatement` alone is enough.
 *  2. Each answer writes its own statement KIND with the wording version the registry lists for it, and only a third-party
 *     answer forces Private. "I wrote this" sends no confirmation (the statement is the confirmation).
 *  3. Answer 5 (publish privately) exists on the editor and nowhere else.
 */
import { RecipeVisibility, STATEMENT_WORDINGS_BY_CHOICE } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import {
    answersFor,
    askForStatement,
    initialSheet,
    phaseOf,
    sheetReducer,
    publicWordingOf,
    statementFieldErrorOf,
    statementWriteOf,
    type StatementSheetState,
} from '../sourceStatement.js';

const ASK = {
    draftPasted: true,
    recipe: undefined,
    draftHasSource: false,
    answered: false,
    resultPublic: true,
} as const;

describe('askForStatement', () => {
    it('asks for a pasted draft that ends public', () => {
        expect(askForStatement(ASK)).toBe(true);
    });

    it('does not ask for a typed recipe', () => {
        expect(askForStatement({ ...ASK, draftPasted: false })).toBe(false);
    });

    it('asks when the server says a statement is owed, though this draft was never pasted into', () => {
        expect(
            askForStatement({
                ...ASK,
                draftPasted: false,
                recipe: { publicNeedsStatement: true, sourceType: 'user_created' },
            }),
        ).toBe(true);
    });

    it('does not ask when the server holds a statement already', () => {
        expect(
            askForStatement({
                ...ASK,
                recipe: { publicNeedsStatement: false, sourceType: 'user_created', statementKind: 'authored' },
            }),
        ).toBe(false);
    });

    it('does not ask for a recipe that is not the cook’s own words (a stated source label)', () => {
        expect(askForStatement({ ...ASK, recipe: { sourceType: 'imported_public' } })).toBe(false);
    });

    it('does not ask when the draft states a source: it ends private', () => {
        expect(askForStatement({ ...ASK, draftHasSource: true })).toBe(false);
    });

    it('does not ask again once answered in this session', () => {
        expect(askForStatement({ ...ASK, answered: true })).toBe(false);
    });

    it('does not ask for a result that is not public', () => {
        expect(askForStatement({ ...ASK, resultPublic: false })).toBe(false);
    });
});

describe('answersFor', () => {
    it('gives the editor five answers, in order, ending with publishing privately', () => {
        expect(answersFor('editor')).toEqual(['authored', 'publicWeb', 'book', 'fromPerson', 'publishPrivately']);
    });

    it('gives the recipe page the first four only', () => {
        expect(answersFor('recipePage')).toEqual(['authored', 'publicWeb', 'book', 'fromPerson']);
    });
});

describe('publicWordingOf', () => {
    it('names the passive line and the locale it was shown in', () => {
        expect(publicWordingOf('en')).toEqual({ version: 'publicConfirm.v1', locale: 'en' });
    });

    it('records en for a locale the line fell back from', () => {
        expect(publicWordingOf('fr-CA')).toEqual({ version: 'publicConfirm.v1', locale: 'en' });
    });
});

describe('statementWriteOf', () => {
    const FIELDS = { link: 'https://www.allrecipes.com/recipe/1/soup/', bookTitle: ' Joy of Cooking, p. 12 ' };

    it('"I wrote this" states authored, stays public and sends no confirmation', () => {
        expect(statementWriteOf('authored', FIELDS, 'en')).toEqual({
            statement: {
                kind: 'authored',
                wording: { version: STATEMENT_WORDINGS_BY_CHOICE.authored[0], locale: 'en' },
            },
            visibility: RecipeVisibility.PUBLIC,
        });
    });

    // The wording's locale is the catalog that served the words, so a request the catalog does not hold falls back to English
    // and records English (review item 10).
    it('a web page states its link and forces Private, and a locale the words fell back from is recorded as en', () => {
        expect(statementWriteOf('publicWeb', FIELDS, 'fr-CA')).toEqual({
            statement: {
                kind: 'public_web',
                citation: 'https://www.allrecipes.com/recipe/1/soup/',
                wording: { version: STATEMENT_WORDINGS_BY_CHOICE.publicWeb[0], locale: 'en' },
            },
            visibility: RecipeVisibility.PRIVATE,
        });
    });

    it('a cookbook states its trimmed title as the citation and forces Private', () => {
        expect(statementWriteOf('book', FIELDS, 'en')).toEqual({
            statement: {
                kind: 'book',
                citation: 'Joy of Cooking, p. 12',
                wording: { version: STATEMENT_WORDINGS_BY_CHOICE.book[0], locale: 'en' },
            },
            visibility: RecipeVisibility.PRIVATE,
        });
    });

    it('another person states fromPerson and forces Private', () => {
        expect(statementWriteOf('fromPerson', FIELDS, 'en')).toEqual({
            statement: {
                kind: 'fromPerson',
                wording: { version: STATEMENT_WORDINGS_BY_CHOICE.fromPerson[0], locale: 'en' },
            },
            visibility: RecipeVisibility.PRIVATE,
        });
    });

    it('publishing privately states nothing and is Private', () => {
        const write = statementWriteOf('publishPrivately', FIELDS, 'en');

        expect(write).toEqual({ visibility: RecipeVisibility.PRIVATE });
        expect(write).not.toHaveProperty('statement');
    });
});

describe('statementFieldErrorOf', () => {
    it('is none for the answers with no field', () => {
        for (const answer of ['authored', 'fromPerson', 'publishPrivately'] as const) {
            expect(statementFieldErrorOf(answer, { link: '', bookTitle: '' })).toBeUndefined();
        }
    });

    it('names an empty or blank book title', () => {
        expect(statementFieldErrorOf('book', { link: '', bookTitle: '   ' })).toEqual({
            field: 'bookTitle',
            reason: 'required',
        });
        expect(statementFieldErrorOf('book', { link: '', bookTitle: 'Joy' })).toBeUndefined();
    });

    it('names an empty, unusable or own-site link, by the one reading the source field uses', () => {
        expect(statementFieldErrorOf('publicWeb', { link: '', bookTitle: '' })).toEqual({
            field: 'link',
            reason: 'required',
        });
        expect(statementFieldErrorOf('publicWeb', { link: 'not a link', bookTitle: '' })).toEqual({
            field: 'link',
            reason: 'invalid',
        });
        expect(statementFieldErrorOf('publicWeb', { link: 'https://commise.app/recipes/1', bookTitle: '' })).toEqual({
            field: 'link',
            reason: 'ownSite',
        });
        expect(
            statementFieldErrorOf('publicWeb', { link: 'https://www.allrecipes.com/recipe/1/soup/', bookTitle: '' }),
        ).toBeUndefined();
    });
});

describe('the sheet state', () => {
    const open = initialSheet();

    const reduce = (...actions: Parameters<typeof sheetReducer>[1][]): StatementSheetState =>
        actions.reduce(sheetReducer, open);

    it('starts choosing: no answer, nothing to confirm', () => {
        expect(phaseOf(open)).toBe('choosing');
    });

    it('is answered once an answer is picked', () => {
        expect(phaseOf(reduce({ type: 'choose', answer: 'authored' }))).toBe('answered');
    });

    it('shows a field error only after Confirm was pressed with an invalid field, and clears it when the field is fixed', () => {
        const attempted = reduce({ type: 'choose', answer: 'book' }, { type: 'attempt' });

        expect(phaseOf(attempted)).toBe('fieldError');
        expect(phaseOf(sheetReducer(attempted, { type: 'bookTitle', text: 'Joy' }))).toBe('answered');
    });

    it('raises the focus request on every attempt and lowers it when the field has taken it', () => {
        const attempted = reduce({ type: 'choose', answer: 'book' }, { type: 'attempt' });
        const handled = sheetReducer(attempted, { type: 'focusHandled' });

        expect(attempted.focusPending).toBe(true);
        expect(handled.focusPending).toBe(false);
        expect(sheetReducer(handled, { type: 'attempt' }).focusPending).toBe(true);
    });

    it('does not show a field error for a valid answer that was attempted', () => {
        expect(phaseOf(reduce({ type: 'choose', answer: 'authored' }, { type: 'attempt' }))).toBe('answered');
    });

    it('goes busy, then error on a failure, and retries back to busy', () => {
        const busy = reduce({ type: 'choose', answer: 'authored' }, { type: 'busy' });

        expect(phaseOf(busy)).toBe('busy');
        expect(phaseOf(sheetReducer(busy, { type: 'failed' }))).toBe('error');
        expect(phaseOf(sheetReducer(sheetReducer(busy, { type: 'failed' }), { type: 'busy' }))).toBe('busy');
    });

    it('keeps the chosen answer and the typed fields through busy and error', () => {
        const state = reduce(
            { type: 'choose', answer: 'book' },
            { type: 'bookTitle', text: 'Joy' },
            { type: 'busy' },
            { type: 'failed' },
        );

        expect(state).toMatchObject({ answer: 'book', bookTitle: 'Joy' });
    });

    it('resets on close', () => {
        expect(reduce({ type: 'choose', answer: 'book' }, { type: 'reset' })).toEqual(open);
    });
});
