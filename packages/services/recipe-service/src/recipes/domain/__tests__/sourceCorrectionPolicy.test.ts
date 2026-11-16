/**
 * Unit tests for the pure source-correction policy (ADR-0089): may a PATCH change a recipe's source, and what does the write
 * leave? A literal table over `(statement, stored source, ever published, stored visibility)`.
 *
 * The rows a mutant must not survive:
 *
 *  1. **The first publish does not lock the statement.** Every row of the table gives the same answer for a recipe
 *     published once and one never published (owner ruling 2026-11-15, ADR-0093 section 8). The tests that said "locked
 *     after the first publish" are rewritten to prove it.
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
    clonedFromId: null,
};

/** The stored source as a recipe published once holds it. The policy reads no first-publish fact, so this must change nothing. */
function publishedOnce(source: StoredSource): StoredSource {
    const withTheFact = { ...source, firstPublishedAt: AT };

    return withTheFact;
}

function stored(over: Partial<StoredSource>): StoredSource {
    return { ...NONE, ...over };
}

const WEB_COPY = { sourceType: 'imported_public', sourceKind: 'public_web', statementKind: 'source' } as const;

describe('evaluateSourceCorrection — a body with no statement', () => {
    it.each([NONE, publishedOnce(NONE), stored(WEB_COPY)])('changes nothing: %j', (source) => {
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

    // A clear over nothing took no effect: the attestation record must not say the cook cleared a statement they never made.
    it('is `unchanged` for a recipe that states nothing, so a clear with nothing stored leaves no trace', () => {
        expect(evaluateSourceCorrection({ statement: null, stored: NONE })).toEqual({ kind: 'unchanged' });
    });
});

describe('evaluateSourceCorrection — the source is locked', () => {
    it('after the first publish, a clear of a recipe that states nothing is `unchanged`, not locked', () => {
        expect(evaluateSourceCorrection({ statement: null, stored: publishedOnce(NONE) })).toEqual({
            kind: 'unchanged',
        });
    });

    it.each([
        ['a web link', STATEMENT, true],
        ['a cookbook', BOOK, true],
        ['another person', FROM_PERSON, true],
    ] as const)(
        'after the first publish, from no statement, %s applies, and it forces Private',
        (_name, statement, makePrivate) => {
            expect(evaluateSourceCorrection({ statement, stored: publishedOnce(NONE) })).toMatchObject({
                kind: 'apply',
                makePrivate,
            });
        },
    );

    it('after the first publish, authored replaces a web copy and forces no Private', () => {
        expect(
            evaluateSourceCorrection({ statement: AUTHORED, stored: publishedOnce(stored(WEB_COPY)) }),
        ).toMatchObject({
            kind: 'apply',
            provenance: { statementKind: 'authored', sourceKind: null },
            makePrivate: false,
        });
    });

    it('keeps a re-drafted recipe editable too: the policy reads no first-publish fact and no status', () => {
        expect(
            evaluateSourceCorrection({ statement: STATEMENT, stored: publishedOnce(stored(WEB_COPY)) }),
        ).toMatchObject({ kind: 'apply' });
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

    it('AFTER the first publish, from no statement, is allowed', () => {
        expect(evaluateSourceCorrection({ statement: AUTHORED, stored: publishedOnce(NONE) })).toEqual({
            kind: 'apply',
            provenance: AUTHORED_PROVENANCE,
            makePrivate: false,
        });
    });

    it('after the first publish, a clone that inherited no statement may attest too', () => {
        expect(
            evaluateSourceCorrection({
                statement: AUTHORED,
                stored: publishedOnce(stored({ clonedFromId: 'r-1' })),
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

    // Rewritten by ADR-0095: it used to say `apply`, which wrote the same columns again and recorded a second attestation for
    // an act that changed nothing. The record is built from what a write did, so saying it again is `unchanged` in the window too.
    it('before the first publish, says it again: nothing to write, so it is `unchanged`', () => {
        expect(evaluateSourceCorrection({ statement: AUTHORED, stored: AUTHORED_STORED })).toEqual({
            kind: 'unchanged',
        });
    });

    // A retry of the recipe page's "PATCH authored, then set visibility" must not meet SOURCE_LOCKED because the first half landed.
    it('AFTER the first publish, says it again: nothing to write, so it is `unchanged`, not locked', () => {
        expect(
            evaluateSourceCorrection({
                statement: AUTHORED,
                stored: publishedOnce(stored({ statementKind: 'authored' })),
            }),
        ).toEqual({ kind: 'unchanged' });
    });

    // Rewritten by the 2026-11-15 ruling: it used to say `locked`. A cook may change their statement after the first publish;
    // the attestation record keeps the history, and `sourceConflict` and `statementRequired` still judge Public.
    it('after the first publish, clearing an authored statement applies: the statement is the cook\u2019s to change', () => {
        expect(
            evaluateSourceCorrection({
                statement: null,
                stored: publishedOnce(stored({ statementKind: 'authored' })),
            }),
        ).toMatchObject({ kind: 'apply', provenance: { statementKind: null }, makePrivate: false });
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
        ['from another person', stored({ statementKind: 'fromPerson' })],
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

    // [source, move, outcome]. The outcome is the same for a recipe never published and one published once (2026-11-15
    // ruling). A stated book is correctable; a paid site and the curator's text never are.
    // "From another person" and a book are locked exactly where a web link is: setBook and fromPerson behave as setWeb here.
    const TABLE: ReadonlyArray<readonly [string, Move, string]> = [
        ['no statement', 'setWeb', 'apply'],
        ['no statement', 'clear', 'unchanged'],
        ['no statement', 'authored', 'apply'],
        ['no statement', 'setBook', 'apply'],
        ['no statement', 'fromPerson', 'apply'],
        ['authored', 'setWeb', 'apply'],
        ['authored', 'clear', 'apply'],
        ['authored', 'authored', 'unchanged'],
        ['authored', 'setBook', 'apply'],
        ['authored', 'fromPerson', 'apply'],
        ['from another person', 'setWeb', 'apply'],
        ['from another person', 'clear', 'apply'],
        ['from another person', 'authored', 'apply'],
        ['from another person', 'setBook', 'apply'],
        ['from another person', 'fromPerson', 'unchanged'],
        ['a stated web copy', 'setWeb', 'apply'],
        ['a stated web copy', 'clear', 'apply'],
        ['a stated web copy', 'authored', 'apply'],
        ['a stated web copy', 'setBook', 'apply'],
        ['a stated web copy', 'fromPerson', 'apply'],
        ['the curator’s text', 'setWeb', 'locked'],
        ['the curator’s text', 'clear', 'locked'],
        ['the curator’s text', 'authored', 'locked'],
        ['the curator’s text', 'setBook', 'locked'],
        ['the curator’s text', 'fromPerson', 'locked'],
        ['a stated book', 'setWeb', 'apply'],
        ['a stated book', 'clear', 'apply'],
        ['a stated book', 'authored', 'apply'],
        ['a stated book', 'setBook', 'apply'],
        ['a stated book', 'fromPerson', 'apply'],
        ['a stated paid site', 'setWeb', 'locked'],
        ['a stated paid site', 'clear', 'locked'],
        ['a stated paid site', 'authored', 'locked'],
        ['a stated paid site', 'setBook', 'locked'],
        ['a stated paid site', 'fromPerson', 'locked'],
        ['a web copy inherited by a clone', 'setWeb', 'locked'],
        ['a web copy inherited by a clone', 'clear', 'locked'],
        ['a web copy inherited by a clone', 'authored', 'locked'],
        ['a web copy inherited by a clone', 'setBook', 'locked'],
        ['a web copy inherited by a clone', 'fromPerson', 'locked'],
    ];

    it('covers every source × move exactly once', () => {
        expect(TABLE.map(([name, move]) => `${name}/${move}`).sort()).toEqual(
            SOURCES.flatMap(([name]) => MOVES.map((move) => `${name}/${move}`)).sort(),
        );
    });

    it.each(TABLE)('%s, %s: %s, published once or not', (name, move, outcome) => {
        const source = SOURCES.find(([label]) => label === name)?.[1];

        if (source === undefined) {
            throw new Error(`no source named ${name}`);
        }

        const statement = STATEMENT_OF[move];

        expect(evaluateSourceCorrection({ statement, stored: source }).kind).toBe(outcome);
        expect(evaluateSourceCorrection({ statement, stored: publishedOnce(source) }).kind).toBe(outcome);
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

    it('"from another person" sets no source, stores the statement, and makes the recipe Private in the same write', () => {
        expect(evaluateSourceCorrection({ statement: FROM_PERSON, stored: NONE })).toEqual({
            kind: 'apply',
            provenance: {
                sourceType: 'user_created',
                sourceUrl: null,
                sourceAttribution: null,
                sourceKind: null,
                statementKind: 'fromPerson',
            },
            makePrivate: true,
        });
    });

    it('lets "from another person" be changed to "I wrote this" before the first publish, which is what makes the recipe publishable', () => {
        expect(
            evaluateSourceCorrection({ statement: AUTHORED, stored: stored({ statementKind: 'fromPerson' }) }),
        ).toMatchObject({ kind: 'apply', provenance: { statementKind: 'authored' }, makePrivate: false });
    });

    it('lets "from another person" be cleared before the first publish, and says nothing of visibility', () => {
        expect(
            evaluateSourceCorrection({ statement: null, stored: stored({ statementKind: 'fromPerson' }) }),
        ).toMatchObject({
            kind: 'apply',
            provenance: { statementKind: null },
            makePrivate: false,
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

    // Rewritten by the 2026-11-15 ruling: it used to say `locked`. A held statement can be changed after the first publish,
    // and a third-party one forces Private in the same write.
    it.each([BOOK, FROM_PERSON])('after the first publish, changes a held statement and forces Private (%j)', (statement) => {
        expect(
            evaluateSourceCorrection({
                statement,
                stored: publishedOnce(stored({ statementKind: 'authored' })),
            }),
        ).toMatchObject({ kind: 'apply', makePrivate: true });
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
