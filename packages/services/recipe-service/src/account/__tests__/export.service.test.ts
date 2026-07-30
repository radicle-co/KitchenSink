/**
 * Unit tests for {@link AccountExportService}: the assembly of the seven owner-scoped reads into the
 * {@link AccountExport} contract, over a mocked {@link AccountExportDal}.
 *
 * Requirement → test map:
 *
 *   - **FR-038 / owner scoping** — the service reads EVERY root keyed on the exact `ownerId` it was given
 *     (the verified token owner), and echoes it back on the document.
 *     → `describe('owner scoping')`
 *   - **api.openapi.yaml `AccountExport`** — the document carries all seven arrays, memberships are
 *     grouped under their collection, photo URLs are resolved against the configured CDN, and `exportedAt`
 *     is an ISO timestamp.
 *     → `describe('the assembled document')`
 *
 * The wire status code (`200`) and real cross-owner isolation are pinned by the integration + e2e tiers;
 * the pure row→export mapping is exhausted in `export.mappers.test.ts`. This tier owns the composition.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AccountExportService, type AccountExportConfig } from '../export.service.js';
import type { AccountExportDal } from '../dal/export.dal.js';
import {
    makeAuthorHandleRow,
    makeCollectionRow,
    makeMembershipRow,
    makePhotoRow,
    makeRatingRow,
    makeRecipeRow,
    makeVersionRow,
} from '../__fixtures__/export.fixtures.js';

type DalMock = { [K in keyof AccountExportDal]: ReturnType<typeof vi.fn> };

const OWNER = '01JEXPORTSERVICEOWNER0000A';
const CONFIG: AccountExportConfig = { cloudfrontUrl: 'https://cdn.example.com' };

let dal: DalMock;
let service: AccountExportService;

beforeEach(() => {
    dal = {
        listRecipes: vi.fn().mockResolvedValue([makeRecipeRow()]),
        listCollections: vi.fn().mockResolvedValue([makeCollectionRow({ id: 'coll-A' })]),
        listCollectionMemberships: vi.fn().mockResolvedValue([makeMembershipRow({ collectionId: 'coll-A' })]),
        listRatings: vi.fn().mockResolvedValue([makeRatingRow()]),
        listPhotos: vi.fn().mockResolvedValue([makePhotoRow({ s3Key: 'k/orig.jpg', thumbnailKey: null })]),
        listVersions: vi.fn().mockResolvedValue([makeVersionRow()]),
        listAuthorHandles: vi.fn().mockResolvedValue([makeAuthorHandleRow()]),
    };
    service = new AccountExportService(dal as unknown as AccountExportDal, CONFIG);
});

describe('owner scoping', () => {
    it('reads every root keyed on the given ownerId, and echoes it on the document', async () => {
        const result = await service.exportForOwner(OWNER);

        for (const read of Object.values(dal)) {
            expect(read).toHaveBeenCalledExactlyOnceWith(OWNER);
        }

        expect(result.ownerId).toBe(OWNER);
    });
});

describe('the assembled document', () => {
    it('carries all seven arrays', async () => {
        const result = await service.exportForOwner(OWNER);

        expect(Object.keys(result).sort()).toEqual(
            [
                'authorHandles',
                'collections',
                'exportedAt',
                'ownerId',
                'photos',
                'ratings',
                'recipes',
                'versions',
            ].sort(),
        );
        expect(result.recipes).toHaveLength(1);
        expect(result.ratings).toHaveLength(1);
        expect(result.photos).toHaveLength(1);
        expect(result.versions).toHaveLength(1);
        expect(result.authorHandles).toHaveLength(1);
    });

    it("groups each collection's memberships under it", async () => {
        const result = await service.exportForOwner(OWNER);

        expect(result.collections).toHaveLength(1);
        expect(result.collections[0]?.id).toBe('coll-A');
        expect(result.collections[0]?.recipes).toHaveLength(1);
    });

    it('resolves photo URLs against the configured CDN base', async () => {
        const result = await service.exportForOwner(OWNER);

        expect(result.photos[0]?.url).toBe('https://cdn.example.com/k/orig.jpg');
    });

    it('stamps an ISO-8601 exportedAt', async () => {
        const result = await service.exportForOwner(OWNER);

        expect(Number.isNaN(Date.parse(result.exportedAt))).toBe(false);
        expect(result.exportedAt).toBe(new Date(result.exportedAt).toISOString());
    });

    it('returns empty arrays for a user who holds nothing (no fabricated data)', async () => {
        for (const read of Object.values(dal)) {
            read.mockResolvedValue([]);
        }

        const result = await service.exportForOwner(OWNER);

        expect(result).toMatchObject({
            ownerId: OWNER,
            recipes: [],
            collections: [],
            ratings: [],
            photos: [],
            versions: [],
            authorHandles: [],
        });
    });
});
