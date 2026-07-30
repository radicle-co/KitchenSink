/**
 * Unit tests for the pure row→export Data Mappers (`export.mappers.ts`) — the GDPR export's
 * transformation core.
 *
 * Requirement → test map:
 *
 *   - **Art. 20 (§Dates)** — every `timestamptz` is normalized to an ISO-8601 string, from BOTH a `Date`
 *     (pg's default) and an already-ISO string; nullable timestamps preserve `null`.
 *     → `describe('toIsoString / toIsoStringOrNull')`
 *   - **faithful mirror** — nullable columns are carried through as explicit `null`, not dropped; a
 *     tombstoned recipe's `deletedAt` is exported (so the document mirrors what erasure removes).
 *     → `describe('mapRecipe')`
 *   - **owner-scoped grouping** — a collection embeds ONLY its own memberships (filtered by `collectionId`).
 *     → `describe('mapCollection')`
 *   - **metadata, not bytes** — a photo resolves both CDN URLs from its keys; a thumbnail-less photo maps
 *     `thumbnailUrl` to `null`; a version maps metadata only.
 *     → `describe('mapPhoto')` / `describe('mapVersion')`
 */
import { describe, it, expect } from 'vitest';

import {
    mapAuthorHandle,
    mapCollection,
    mapMembership,
    mapPhoto,
    mapRating,
    mapRecipe,
    mapVersion,
    toIsoString,
    toIsoStringOrNull,
} from '../export.mappers.js';
import {
    makeAuthorHandleRow,
    makeCollectionRow,
    makeMembershipRow,
    makePhotoRow,
    makeRatingRow,
    makeRecipeRow,
    makeVersionRow,
} from '../__fixtures__/export.fixtures.js';

const CDN = 'https://cdn.example.com';

describe('toIsoString / toIsoStringOrNull', () => {
    it('normalizes a Date to an ISO-8601 string', () => {
        expect(toIsoString(new Date('2026-01-15T12:00:00.000Z'))).toBe('2026-01-15T12:00:00.000Z');
    });

    it('normalizes a pg timestamp string to an ISO-8601 string', () => {
        expect(toIsoString('2026-01-15 12:00:00+00')).toBe('2026-01-15T12:00:00.000Z');
    });

    it('preserves null for a nullable timestamp', () => {
        expect(toIsoStringOrNull(null)).toBeNull();
        expect(toIsoStringOrNull(new Date('2026-01-15T12:00:00.000Z'))).toBe('2026-01-15T12:00:00.000Z');
    });
});

describe('mapRecipe', () => {
    it('maps every field and renders dates as ISO strings', () => {
        const result = mapRecipe(makeRecipeRow());

        expect(result).toMatchObject({
            id: '00000000-0000-4000-8000-00000000r001',
            title: 'Classic Margherita Pizza',
            dietaryFlags: ['vegetarian'],
            tags: ['dinner'],
            averageRating: '4.50',
            createdAt: '2026-01-15T12:00:00.000Z',
            updatedAt: '2026-02-20T09:30:00.000Z',
        });
    });

    it('carries nullable columns through as explicit null (a full-shape document)', () => {
        const result = mapRecipe(
            makeRecipeRow({ description: null, difficulty: null, cuisine: null, authorHandle: null }),
        );

        expect(result.description).toBeNull();
        expect(result.difficulty).toBeNull();
        expect(result.cuisine).toBeNull();
        expect(result.authorHandle).toBeNull();
    });

    it('exports a tombstoned recipe with its deletedAt, so the export mirrors what erasure removes', () => {
        const result = mapRecipe(makeRecipeRow({ deletedAt: new Date('2026-03-01T00:00:00.000Z'), status: 'draft' }));

        expect(result.deletedAt).toBe('2026-03-01T00:00:00.000Z');
        expect(result.status).toBe('draft');
    });

    it('leaves an active recipe deletedAt null', () => {
        expect(mapRecipe(makeRecipeRow()).deletedAt).toBeNull();
    });
});

describe('mapMembership', () => {
    it('maps a junction row to { recipeId, addedAt, addedVia }', () => {
        const result = mapMembership(makeMembershipRow({ addedVia: 'clone_seed' }));

        expect(result).toEqual({
            recipeId: '00000000-0000-4000-8000-00000000r001',
            addedAt: '2026-01-15T12:00:00.000Z',
            addedVia: 'clone_seed',
        });
    });
});

describe('mapCollection', () => {
    it('embeds only the memberships whose collectionId matches (owner-scoped grouping)', () => {
        const collection = makeCollectionRow({ id: 'coll-A' });
        const memberships = [
            makeMembershipRow({ collectionId: 'coll-A', recipeId: 'r1' }),
            makeMembershipRow({ collectionId: 'coll-B', recipeId: 'r2' }),
            makeMembershipRow({ collectionId: 'coll-A', recipeId: 'r3' }),
        ];

        const result = mapCollection(collection, memberships);

        expect(result.recipes.map((member) => member.recipeId)).toEqual(['r1', 'r3']);
    });

    it('maps a membership-less collection to an empty recipes array', () => {
        const result = mapCollection(makeCollectionRow({ id: 'coll-A' }), []);

        expect(result.recipes).toEqual([]);
    });

    it('renders lastPulledAt as ISO when present and null when absent', () => {
        expect(mapCollection(makeCollectionRow({ lastPulledAt: null }), []).lastPulledAt).toBeNull();
        expect(
            mapCollection(makeCollectionRow({ lastPulledAt: new Date('2026-04-01T00:00:00.000Z') }), []).lastPulledAt,
        ).toBe('2026-04-01T00:00:00.000Z');
    });
});

describe('mapRating', () => {
    it('maps a rating row with ISO dates', () => {
        const result = mapRating(makeRatingRow({ stars: 3 }));

        expect(result).toMatchObject({ stars: 3, createdAt: '2026-01-15T12:00:00.000Z' });
    });
});

describe('mapPhoto', () => {
    it('resolves both the full-size and thumbnail CDN URLs from the keys (metadata, not bytes)', () => {
        const result = mapPhoto(makePhotoRow({ s3Key: 'k/orig.jpg', thumbnailKey: 'k/thumb.jpg' }), CDN);

        expect(result.key).toBe('k/orig.jpg');
        expect(result.url).toBe('https://cdn.example.com/k/orig.jpg');
        expect(result.thumbnailKey).toBe('k/thumb.jpg');
        expect(result.thumbnailUrl).toBe('https://cdn.example.com/k/thumb.jpg');
    });

    it('maps thumbnailUrl to null when the photo has no thumbnail rendition', () => {
        const result = mapPhoto(makePhotoRow({ thumbnailKey: null }), CDN);

        expect(result.thumbnailKey).toBeNull();
        expect(result.thumbnailUrl).toBeNull();
    });
});

describe('mapVersion', () => {
    it('maps version metadata only (no snapshot field)', () => {
        const result = mapVersion(makeVersionRow({ versionNumber: 3, baseVersion: 2 }));

        expect(result).toEqual({
            id: '00000000-0000-4000-8000-00000000v001',
            recipeId: '00000000-0000-4000-8000-00000000r001',
            versionNumber: 3,
            baseVersion: 2,
            s3Key: null,
            createdBy: expect.any(String),
            changeSummary: 'Initial version',
            deviceLabel: null,
            editorHandle: 'chef-anna',
            createdAt: '2026-01-15T12:00:00.000Z',
        });
        expect(result).not.toHaveProperty('snapshot');
    });
});

describe('mapAuthorHandle', () => {
    it('maps an author-handle row with an ISO sourceTimestamp', () => {
        const result = mapAuthorHandle(makeAuthorHandleRow());

        expect(result).toEqual({
            userId: expect.any(String),
            displayName: 'Chef Anna',
            sourceTimestamp: '2026-02-20T09:30:00.000Z',
        });
    });
});
