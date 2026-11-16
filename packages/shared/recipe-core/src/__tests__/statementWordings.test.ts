import { describe, expect, it } from 'vitest';

import {
    PUBLIC_CONFIRM_WORDINGS,
    PUBLIC_CONFIRMATION_FOR_API_WRITERS,
    STATEMENT_WORDINGS,
    STATEMENT_WORDINGS_BY_CHOICE,
    WORDING_LOCALE_MAX_LENGTH,
    WORDING_LOCALE_MIN_LENGTH,
} from '../statementWordings.js';

/** The format the database CHECK on `recipe_statement_attestations.wording_version` accepts (migration 0088). */
const WORDING_FORMAT = /^[a-z][A-Za-z0-9]*\.v[0-9]+$/;

describe('the closed wording lists (the copy a cook saw)', () => {
    it('names exactly the four statement wordings and the one confirmation, as the blueprint fixes them', () => {
        expect([...STATEMENT_WORDINGS].sort()).toEqual([
            'statementAuthored.v1',
            'statementBook.v1',
            'statementFromPerson.v1',
            'statementPublicWeb.v1',
        ]);
        expect([...PUBLIC_CONFIRM_WORDINGS]).toEqual(['publicConfirm.v1']);
    });

    it.each([...STATEMENT_WORDINGS, ...PUBLIC_CONFIRM_WORDINGS])('%s fits the database format CHECK', (wording) => {
        expect(wording).toMatch(WORDING_FORMAT);
    });

    it('derives the flat statement list from the per-choice record, so the two cannot disagree', () => {
        expect(Object.keys(STATEMENT_WORDINGS_BY_CHOICE).sort()).toEqual([
            'authored',
            'book',
            'fromPerson',
            'publicWeb',
        ]);
        expect([...STATEMENT_WORDINGS].sort()).toEqual(Object.values(STATEMENT_WORDINGS_BY_CHOICE).flat().sort());
    });

    it('keeps each wording under its own choice: the book wording is not the authored one', () => {
        expect(STATEMENT_WORDINGS_BY_CHOICE.authored).toEqual(['statementAuthored.v1']);
        expect(STATEMENT_WORDINGS_BY_CHOICE.publicWeb).toEqual(['statementPublicWeb.v1']);
        expect(STATEMENT_WORDINGS_BY_CHOICE.book).toEqual(['statementBook.v1']);
        expect(STATEMENT_WORDINGS_BY_CHOICE.fromPerson).toEqual(['statementFromPerson.v1']);
    });
});

describe('PUBLIC_CONFIRMATION_FOR_API_WRITERS', () => {
    it('is the first public-confirm wording in English, the one every API writer sends', () => {
        expect(PUBLIC_CONFIRMATION_FOR_API_WRITERS).toEqual({ version: 'publicConfirm.v1', locale: 'en' });
        expect(PUBLIC_CONFIRM_WORDINGS).toContain(PUBLIC_CONFIRMATION_FOR_API_WRITERS.version);
    });

    it('has a locale inside the bounds the database CHECK enforces', () => {
        expect(PUBLIC_CONFIRMATION_FOR_API_WRITERS.locale.length).toBeGreaterThanOrEqual(WORDING_LOCALE_MIN_LENGTH);
        expect(PUBLIC_CONFIRMATION_FOR_API_WRITERS.locale.length).toBeLessThanOrEqual(WORDING_LOCALE_MAX_LENGTH);
        expect([WORDING_LOCALE_MIN_LENGTH, WORDING_LOCALE_MAX_LENGTH]).toEqual([2, 35]);
    });
});
