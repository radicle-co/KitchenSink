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
    it('names exactly the five statement wordings and the one confirmation, as the blueprint fixes them', () => {
        expect([...STATEMENT_WORDINGS].sort()).toEqual([
            'statementAuthored.v1',
            'statementBook.v1',
            'statementFromPerson.v1',
            'statementPaidSite.v1',
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
            'paidSite',
            'publicWeb',
        ]);
        expect([...STATEMENT_WORDINGS].sort()).toEqual(Object.values(STATEMENT_WORDINGS_BY_CHOICE).flat().sort());
    });

    it('keeps each wording under its own choice: the book wording is not the authored one', () => {
        expect(STATEMENT_WORDINGS_BY_CHOICE.authored).toEqual(['statementAuthored.v1']);
        expect(STATEMENT_WORDINGS_BY_CHOICE.publicWeb).toEqual(['statementPublicWeb.v1']);
        expect(STATEMENT_WORDINGS_BY_CHOICE.book).toEqual(['statementBook.v1']);
        expect(STATEMENT_WORDINGS_BY_CHOICE.fromPerson).toEqual(['statementFromPerson.v1']);
        expect(STATEMENT_WORDINGS_BY_CHOICE.paidSite).toEqual(['statementPaidSite.v1']);
    });
});

describe('PUBLIC_CONFIRMATION_FOR_API_WRITERS', () => {
    // Rewritten for the provenance review (finding 2): it used to be a wording, so a seed or a load script recorded "the cook
    // saw this line" for a line nobody saw. It is now a marker that satisfies the duty and records nothing, and it names no
    // wording at all.
    it('is the API-writer marker, and carries no wording and no locale to record', () => {
        expect(PUBLIC_CONFIRMATION_FOR_API_WRITERS).toEqual({ apiWriter: true });
        expect(PUBLIC_CONFIRMATION_FOR_API_WRITERS).not.toHaveProperty('version');
        expect(PUBLIC_CONFIRMATION_FOR_API_WRITERS).not.toHaveProperty('locale');
    });

    it('keeps the locale bounds the database CHECK enforces, for the wording a screen sends', () => {
        expect(PUBLIC_CONFIRM_WORDINGS).toEqual(['publicConfirm.v1']);
        expect([WORDING_LOCALE_MIN_LENGTH, WORDING_LOCALE_MAX_LENGTH]).toEqual([2, 35]);
    });
});
