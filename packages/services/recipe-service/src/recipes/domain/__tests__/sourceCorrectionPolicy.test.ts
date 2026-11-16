/**
 * Unit tests for the pure source-correction policy (ADR-0089): may a PATCH change a recipe's source, and what does the write
 * leave? A literal table over `(statement, stored source, ever published, stored visibility)`.
 *
 * The rows a mutant must not survive:
 *
 *  1. **The window closes at the first publish and stays closed.** The fact is `firstPublishedAt`, never `status`: a
 *     published recipe set back to draft is still locked (ADR-0058).
 *  2. **A source the cook did not state is never overwritten**: the curator's public-domain text, a book and a paid-site
 *     recipe are not the cook's to restate through a pasted link.
 *  3. **A statement on a public draft makes it private in the same write; a clear never touches visibility.**
 */
import { describe, expect, it } from 'vitest';
import type { RecipeSourceKind, RecipeSourceType } from '@kitchensink/recipe-core';

import { evaluateSourceCorrection, type StoredSource } from '../sourceCorrectionPolicy.js';

const LINK = 'https://www.allrecipes.com/recipe/1/soup/';
const STATEMENT = {
    kind: 'public_web',
    citation: LINK,
    wording: { version: 'statementPublicWeb.v1', locale: 'en' },
} as const;
const AUTHORED = { kind: 'authored', wording: { version: 'statementAuthored.v1', locale: 'en' } } as const;
const BOOK = {
    kind: 'book',
    citation: 'Joy of Cooking, p. 12',
    wording: { version: 'statementBook.v1', locale: 'en' },
} as const;
const FROM_PERSON = { kind: 'fromPerson', wording: { version: 'statementFromPerson.v1', locale: 'en' } } as const;
const AT = new Date('2026-11-01T00:00:00.000Z');

const NONE: StoredSource = {
    sourceType: 'user_created',
    sourceKind: null,
    statementKind: null,
    firstPublishedAt: null,
    clonedFromId: null,
};

function stored(over: Partial<StoredSource>): StoredSource {
    return { ...NONE, ...over };
}

const WEB_COPY = { sourceType: 'imported_public', sourceKind: 'public_web', statementKind: 'source' } as const;

describe('evaluateSourceCorrection — a body with no statement', () => {
    it.each([NONE, stored({ firstPublishedAt: AT }), stored(WEB_COPY)])('changes nothing: %j', (source) => {
        expect(evaluateSourceCorrection({ statement: undefined, stored: source })).toEqual({ kind: 'unchanged' });
    });
});

describe('evaluateSourceCorrection — a statement before the first publish', () => {
    it('sets the four resolved columns and sets Private in the same write', () => {
        expect(evaluateSourceCorrection({ statement: STATEMENT, stored: NONE })).toEqual({
            kind: 'apply',
            provenance: {
                sourceType: 'imported_public',
                sourceUrl: LINK,
                sourceAttribution: 'allrecipes.com',
                sourceKind: 'public_web',
                statementKind: 'source',
            },
            makePrivate: true,
        });
    });

    // Set Private on EVERY write that sets a source, not from a visibility read outside the lock: a draft that raced to
    // public between the read and the write must still end private.
    it('sets Private whatever visibility the caller last saw, because the policy does not read it', () => {
        expect(evaluateSourceCorrection({ statement: STATEMENT, stored: stored({}) })).toMatchObject({
            kind: 'apply',
            makePrivate: true,
        });
    });

    it('replaces a web source the cook stated earlier', () => {
        const decision = evaluateSourceCorrection({
            statement: STATEMENT,
            stored: stored(WEB_COPY),
        });

        expect(decision).toMatchObject({ kind: 'apply', provenance: { sourceKind: 'public_web', sourceUrl: LINK } });
    });
});

describe('evaluateSourceCorrection — a clear (statement null) before the first publish', () => {
    it('puts the source back to none and never touches the visibility', () => {
        expect(
            evaluateSourceCorrection({
                statement: null,
                stored: stored(WEB_COPY),
            }),
        ).toEqual({
            kind: 'apply',
            provenance: {
                sourceType: 'user_created',
                sourceUrl: null,
                sourceAttribution: null,
                sourceKind: null,
                statementKind: null,
            },
            makePrivate: false,
        });
    });

    it('is a plain write of none for a recipe that had no source', () => {
        expect(evaluateSourceCorrection({ statement: null, stored: NONE })).toMatchObject({ kind: 'apply' });
    });
});

describe('evaluateSourceCorrection — the source is locked', () => {
    it.each([STATEMENT, null])('after the first publish, whatever the statement (%j)', (statement) => {
        expect(evaluateSourceCorrection({ statement, stored: stored({ firstPublishedAt: AT }) })).toEqual({
            kind: 'locked',
        });
    });

    it('after the first publish, a statement over a stated source stays locked: authored cannot relabel a web copy', () => {
        expect(
            evaluateSourceCorrection({ statement: AUTHORED, stored: stored({ ...WEB_COPY, firstPublishedAt: AT }) }),
        ).toEqual({ kind: 'locked' });
    });

    it('keeps a re-drafted recipe locked: the fact is firstPublishedAt, not the status', () => {
        expect(
            evaluateSourceCorrection({ statement: STATEMENT, stored: stored({ ...WEB_COPY, firstPublishedAt: AT }) }),
        ).toEqual({ kind: 'locked' });
    });

    it('for a web source INHERITED by a clone: cloning is not a way to relabel a recipe (ADR-0089)', () => {
        for (const statement of [STATEMENT, null]) {
            expect(
                evaluateSourceCorrection({ statement, stored: stored({ ...WEB_COPY, clonedFromId: 'r-1' }) }),
            ).toEqual({ kind: 'locked' });
        }
    });

    it.each<[RecipeSourceType, RecipeSourceKind | null]>([
        ['imported_public', null],
        ['imported_paid', 'paid_site'],
    ])('for a source the cook did not state through a link: %s with kind %s', (sourceType, sourceKind) => {
        for (const statement of [STATEMENT, null, AUTHORED]) {
            expect(
                evaluateSourceCorrection({
                    statement,
                    stored: stored({ sourceType, sourceKind, statementKind: sourceKind === null ? null : 'source' }),
                }),
            ).toEqual({ kind: 'locked' });
        }
    });
});

describe('evaluateSourceCorrection — a statement that is not a usable source', () => {
    it('is refused, so the policy is total even though the wire schema refuses it first', () => {
        expect(
            evaluateSourceCorrection({
                statement: {
                    kind: 'public_web',
                    citation: 'https://commise.app/recipes/1',
                    wording: { version: 'statementPublicWeb.v1', locale: 'en' },
                },
                stored: NONE,
            }),
        ).toEqual({ kind: 'unusable' });
    });
});

const AUTHORED_PROVENANCE = {
    sourceType: 'user_created',
    sourceUrl: null,
    sourceAttribution: null,
    sourceKind: null,
    statementKind: 'authored',
} as const;
const AUTHORED_STORED = stored({ statementKind: 'authored' });

// The one thing a published recipe may still be told: "I wrote this", from no statement. Without it a recipe published private
// could never go public. Every other move stays exactly as locked as before.
describe('evaluateSourceCorrection — "I wrote this" (Option B)', () => {
    it('before the first publish sets `authored` and does NOT force Private: it states no source', () => {
        expect(evaluateSourceCorrection({ statement: AUTHORED, stored: NONE })).toEqual({
            kind: 'apply',
            provenance: AUTHORED_PROVENANCE,
            makePrivate: false,
        });
    });

    it('AFTER the first publish, from no statement, is still allowed: the one newly allowed move', () => {
        expect(evaluateSourceCorrection({ statement: AUTHORED, stored: stored({ firstPublishedAt: AT }) })).toEqual({
            kind: 'apply',
            provenance: AUTHORED_PROVENANCE,
            makePrivate: false,
        });
    });

    it('after the first publish, a clone that inherited no statement may attest too', () => {
        expect(
            evaluateSourceCorrection({
                statement: AUTHORED,
                stored: stored({ firstPublishedAt: AT, clonedFromId: 'r-1' }),
            }),
        ).toMatchObject({ kind: 'apply' });
    });

    it('before the first publish, replaces a web source the cook stated, and the recipe is not made Private by it', () => {
        expect(evaluateSourceCorrection({ statement: AUTHORED, stored: stored(WEB_COPY) })).toEqual({
            kind: 'apply',
            provenance: AUTHORED_PROVENANCE,
            makePrivate: false,
        });
    });

    it('before the first publish, says it again: allowed, like any correction in the window', () => {
        expect(evaluateSourceCorrection({ statement: AUTHORED, stored: AUTHORED_STORED })).toMatchObject({
            kind: 'apply',
        });
    });

    // A retry of the recipe page's "PATCH authored, then set visibility" must not meet SOURCE_LOCKED because the first half landed.
    it('AFTER the first publish, says it again: nothing to write, so it is `unchanged`, not locked', () => {
        expect(
            evaluateSourceCorrection({
                statement: AUTHORED,
                stored: stored({ statementKind: 'authored', firstPublishedAt: AT }),
            }),
        ).toEqual({ kind: 'unchanged' });
    });

    it('after the first publish, clearing an authored statement stays locked: an attestation is not withdrawn', () => {
        expect(
            evaluateSourceCorrection({
                statement: null,
                stored: stored({ statementKind: 'authored', firstPublishedAt: AT }),
            }),
        ).toEqual({ kind: 'locked' });
    });

    it('clearing before the first publish returns the statement to none', () => {
        expect(evaluateSourceCorrection({ statement: null, stored: AUTHORED_STORED })).toMatchObject({
            kind: 'apply',
            provenance: { statementKind: null },
        });
    });
});

// Every stored source × {set web, clear, authored} × {never published, published once}: the whole policy as one literal table, so
// a mutant that opens a lock the rule keeps shut (or shuts the one it opens) fails a row.
describe('evaluateSourceCorrection — the whole table', () => {
    const SOURCES: ReadonlyArray<readonly [string, StoredSource]> = [
        ['no statement', NONE],
        ['authored', AUTHORED_STORED],
        ['a stated web copy', stored(WEB_COPY)],
        ['the curator’s text', stored({ sourceType: 'imported_public', sourceKind: null })],
        ['a stated book', stored({ sourceType: 'imported_physical', sourceKind: 'book', statementKind: 'source' })],
        [
            'a stated paid site',
            stored({ sourceType: 'imported_paid', sourceKind: 'paid_site', statementKind: 'source' }),
        ],
        ['a web copy inherited by a clone', stored({ ...WEB_COPY, clonedFromId: 'r-1' })],
    ];

    type Move = 'setWeb' | 'clear' | 'authored' | 'setBook' | 'fromPerson';
    const MOVES = ['setWeb', 'clear', 'authored', 'setBook', 'fromPerson'] as const;
    const STATEMENT_OF = {
        setWeb: STATEMENT,
        clear: null,
        authored: AUTHORED,
        setBook: BOOK,
        fromPerson: FROM_PERSON,
    } as const;

    // [source, move, outcome before the first publish, outcome after it]. A book the cook stated in the editor is correctable
    // before the first publish (an import saves published, so an imported book is already locked); a paid site is never.
    // "From another person" and a book are locked exactly where a web link is: setBook and fromPerson behave as setWeb here.
    const TABLE: ReadonlyArray<readonly [string, Move, string, string]> = [
        ['no statement', 'setWeb', 'apply', 'locked'],
        ['no statement', 'clear', 'apply', 'locked'],
        ['no statement', 'authored', 'apply', 'apply'],
        ['no statement', 'setBook', 'apply', 'locked'],
        ['no statement', 'fromPerson', 'apply', 'locked'],
        ['authored', 'setWeb', 'apply', 'locked'],
        ['authored', 'clear', 'apply', 'locked'],
        ['authored', 'authored', 'apply', 'unchanged'],
        ['authored', 'setBook', 'apply', 'locked'],
        ['authored', 'fromPerson', 'apply', 'locked'],
        ['a stated web copy', 'setWeb', 'apply', 'locked'],
        ['a stated web copy', 'clear', 'apply', 'locked'],
        ['a stated web copy', 'authored', 'apply', 'locked'],
        ['a stated web copy', 'setBook', 'apply', 'locked'],
        ['a stated web copy', 'fromPerson', 'apply', 'locked'],
        ['the curator’s text', 'setWeb', 'locked', 'locked'],
        ['the curator’s text', 'clear', 'locked', 'locked'],
        ['the curator’s text', 'authored', 'locked', 'locked'],
        ['the curator’s text', 'setBook', 'locked', 'locked'],
        ['the curator’s text', 'fromPerson', 'locked', 'locked'],
        ['a stated book', 'setWeb', 'apply', 'locked'],
        ['a stated book', 'clear', 'apply', 'locked'],
        ['a stated book', 'authored', 'apply', 'locked'],
        ['a stated book', 'setBook', 'apply', 'locked'],
        ['a stated book', 'fromPerson', 'apply', 'locked'],
        ['a stated paid site', 'setWeb', 'locked', 'locked'],
        ['a stated paid site', 'clear', 'locked', 'locked'],
        ['a stated paid site', 'authored', 'locked', 'locked'],
        ['a stated paid site', 'setBook', 'locked', 'locked'],
        ['a stated paid site', 'fromPerson', 'locked', 'locked'],
        ['a web copy inherited by a clone', 'setWeb', 'locked', 'locked'],
        ['a web copy inherited by a clone', 'clear', 'locked', 'locked'],
        ['a web copy inherited by a clone', 'authored', 'locked', 'locked'],
        ['a web copy inherited by a clone', 'setBook', 'locked', 'locked'],
        ['a web copy inherited by a clone', 'fromPerson', 'locked', 'locked'],
    ];

    it('covers every source × move exactly once', () => {
        expect(TABLE.map(([name, move]) => `${name}/${move}`).sort()).toEqual(
            SOURCES.flatMap(([name]) => MOVES.map((move) => `${name}/${move}`)).sort(),
        );
    });

    it.each(TABLE)('%s, %s: %s before the first publish, %s after', (name, move, before, after) => {
        const source = SOURCES.find(([label]) => label === name)?.[1];

        if (source === undefined) {
            throw new Error(`no source named ${name}`);
        }

        const statement = STATEMENT_OF[move];

        expect(evaluateSourceCorrection({ statement, stored: source }).kind).toBe(before);
        expect(evaluateSourceCorrection({ statement, stored: { ...source, firstPublishedAt: AT } }).kind).toBe(after);
    });
});

describe('evaluateSourceCorrection — a cookbook, or another person, before the first publish', () => {
    it('a book sets the label, the kind, the citation as the credit, and Private in the same write', () => {
        expect(evaluateSourceCorrection({ statement: BOOK, stored: NONE })).toEqual({
            kind: 'apply',
            provenance: {
                sourceType: 'imported_physical',
                sourceUrl: null,
                sourceAttribution: 'Joy of Cooking, p. 12',
                sourceKind: 'book',
                statementKind: 'source',
            },
            makePrivate: true,
        });
    });

    it('"from another person" sets no source and no statement, but still makes the recipe Private in the same write', () => {
        expect(evaluateSourceCorrection({ statement: FROM_PERSON, stored: NONE })).toEqual({
            kind: 'apply',
            provenance: {
                sourceType: 'user_created',
                sourceUrl: null,
                sourceAttribution: null,
                sourceKind: null,
                statementKind: null,
            },
            makePrivate: true,
        });
    });

    it('replaces a stated book with a web link, and a web link with a book', () => {
        expect(
            evaluateSourceCorrection({
                statement: STATEMENT,
                stored: stored({ sourceType: 'imported_physical', sourceKind: 'book', statementKind: 'source' }),
            }),
        ).toMatchObject({ kind: 'apply', provenance: { sourceKind: 'public_web' } });
        expect(evaluateSourceCorrection({ statement: BOOK, stored: stored(WEB_COPY) })).toMatchObject({
            kind: 'apply',
            provenance: { sourceKind: 'book' },
        });
    });

    it('clears a stated book (statement null) without touching the visibility', () => {
        expect(
            evaluateSourceCorrection({
                statement: null,
                stored: stored({ sourceType: 'imported_physical', sourceKind: 'book', statementKind: 'source' }),
            }),
        ).toMatchObject({ kind: 'apply', makePrivate: false });
    });

    it.each([BOOK, FROM_PERSON])('is locked after the first publish, whatever it says (%j)', (statement) => {
        expect(evaluateSourceCorrection({ statement, stored: stored({ firstPublishedAt: AT }) })).toEqual({
            kind: 'locked',
        });
    });

    it('keeps a book INHERITED by a clone locked: cloning is not a way to relabel a recipe', () => {
        expect(
            evaluateSourceCorrection({
                statement: FROM_PERSON,
                stored: stored({
                    sourceType: 'imported_physical',
                    sourceKind: 'book',
                    statementKind: 'source',
                    clonedFromId: 'r-1',
                }),
            }),
        ).toEqual({ kind: 'locked' });
    });
});
