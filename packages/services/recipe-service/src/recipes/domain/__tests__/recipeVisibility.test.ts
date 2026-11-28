/**
 * Unit tests for the pure recipe-viewability predicate {@link isRecipeViewableBy} — the read-side
 * authorization rule reused by `getById` and both collection read paths.
 *
 * The full truth table is pinned so a mutation to any clause (drop the owner check → owners lose their own
 * private/draft recipes; drop the public check → nobody sees public recipes; flip `||`→`&&` → public
 * recipes become invisible to non-owners; drop the status check → drafts LEAK to non-owners) is caught.
 */
import { describe, it, expect } from 'vitest';

import { READABILITY_TABLE } from '../../../../tests/support/readabilityTable.js';
import { isRecipeViewableBy } from '../recipeVisibility.js';

const OWNER = 'owner-1';
const OTHER = 'other-2';

describe('isRecipeViewableBy', () => {
    it('owner sees their own private recipe', () => {
        expect(
            isRecipeViewableBy(
                { ownerId: OWNER, visibility: 'private', status: 'published', heldFromReaders: false },
                OWNER,
            ),
        ).toBe(true);
    });

    it('owner sees their own public recipe', () => {
        expect(
            isRecipeViewableBy(
                { ownerId: OWNER, visibility: 'public', status: 'published', heldFromReaders: false },
                OWNER,
            ),
        ).toBe(true);
    });

    it('a non-owner sees a public published recipe', () => {
        expect(
            isRecipeViewableBy(
                { ownerId: OWNER, visibility: 'public', status: 'published', heldFromReaders: false },
                OTHER,
            ),
        ).toBe(true);
    });

    it("a non-owner does NOT see another user's private recipe", () => {
        expect(
            isRecipeViewableBy(
                { ownerId: OWNER, visibility: 'private', status: 'published', heldFromReaders: false },
                OTHER,
            ),
        ).toBe(false);
    });

    it('owner sees their own DRAFT (draft is owner-visible regardless of visibility) — W8-a.3', () => {
        expect(
            isRecipeViewableBy(
                { ownerId: OWNER, visibility: 'public', status: 'draft', heldFromReaders: false },
                OWNER,
            ),
        ).toBe(true);
        expect(
            isRecipeViewableBy(
                { ownerId: OWNER, visibility: 'private', status: 'draft', heldFromReaders: false },
                OWNER,
            ),
        ).toBe(true);
    });

    it('a non-owner does NOT see a PUBLIC DRAFT — the leak the status term closes (W8-a.3)', () => {
        // A free-tier draft carries visibility='public'; the visibility clause alone would wrongly admit it.
        expect(
            isRecipeViewableBy(
                { ownerId: OWNER, visibility: 'public', status: 'draft', heldFromReaders: false },
                OTHER,
            ),
        ).toBe(false);
    });
});

describe('isRecipeViewableBy: held from readers (ADR-0105)', () => {
    // Every row written by hand: [ownerId, visibility, status, heldFromReaders, viewer, expected].
    it.each([
        [OWNER, 'public', 'published', true, OTHER, false],
        [OWNER, 'public', 'published', false, OTHER, true],
        [OWNER, 'public', 'published', true, OWNER, true],
        [OWNER, 'public', 'draft', true, OWNER, true],
        [OWNER, 'public', 'draft', true, OTHER, false],
        [OWNER, 'private', 'published', true, OTHER, false],
        [OWNER, 'private', 'published', true, OWNER, true],
    ] as const)(
        '%s %s %s held=%s viewed by %s is %s',
        (ownerId, visibility, status, heldFromReaders, viewer, expected) => {
            expect(isRecipeViewableBy({ ownerId, visibility, status, heldFromReaders }, viewer)).toBe(expected);
        },
    );
});

describe('isRecipeViewableBy over the shared literal readability table', () => {
    // A tombstone is a query term, not a row field, so only live rows are in the in-memory rule's scope.
    it.each(READABILITY_TABLE.filter((row) => !row.deleted))('$label', (row) => {
        const fields = {
            ownerId: OWNER,
            visibility: row.visibility,
            status: row.status,
            heldFromReaders: row.held,
        };

        expect(isRecipeViewableBy(fields, OWNER)).toBe(row.ownerReads);
        expect(isRecipeViewableBy(fields, OTHER)).toBe(row.otherReads);
    });

    it('covers all 16 combinations of visibility, status, held and deleted, once each', () => {
        const combinations = READABILITY_TABLE.map(
            (row) => `${row.visibility}/${row.status}/${String(row.held)}/${String(row.deleted)}`,
        );

        expect(new Set(combinations).size).toBe(16);
        expect(combinations).toHaveLength(16);
    });
});
