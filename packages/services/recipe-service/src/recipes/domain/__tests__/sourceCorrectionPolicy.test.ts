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
const STATEMENT = { kind: 'public_web', citation: LINK } as const;
const AT = new Date('2026-11-01T00:00:00.000Z');

const NONE: StoredSource = {
    sourceType: 'user_created',
    sourceKind: null,
    firstPublishedAt: null,
    clonedFromId: null,
};

function stored(over: Partial<StoredSource>): StoredSource {
    return { ...NONE, ...over };
}

const WEB_COPY = { sourceType: 'imported_public', sourceKind: 'public_web' } as const;

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
            provenance: { sourceType: 'user_created', sourceUrl: null, sourceAttribution: null, sourceKind: null },
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
        ['imported_physical', 'book'],
        ['imported_paid', 'paid_site'],
    ])('for a source the cook did not state through a link: %s with kind %s', (sourceType, sourceKind) => {
        for (const statement of [STATEMENT, null]) {
            expect(evaluateSourceCorrection({ statement, stored: stored({ sourceType, sourceKind }) })).toEqual({
                kind: 'locked',
            });
        }
    });
});

describe('evaluateSourceCorrection — a statement that is not a usable source', () => {
    it('is refused, so the policy is total even though the wire schema refuses it first', () => {
        expect(
            evaluateSourceCorrection({
                statement: { kind: 'public_web', citation: 'https://commise.app/recipes/1' },
                stored: NONE,
            }),
        ).toEqual({ kind: 'unusable' });
    });
});
