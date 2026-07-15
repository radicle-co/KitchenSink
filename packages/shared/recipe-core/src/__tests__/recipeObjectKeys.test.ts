/**
 * Unit tests for the shared recipe S3 object-key scheme (ARCH-BE-3).
 *
 * Written BEFORE the module (TDD red → green). This exists because the key scheme was one piece of
 * knowledge with THREE representations that had already drifted apart:
 *   - `recipe-service` `versionArchiveKey`      → `…/versions/{versionNumber}.json`
 *   - `recipe-workers` `snapshotObjectKey`      → `…/versions/{versionId}.json`   ← disagreed
 *   - `recipe-workers` `ownerMediaPrefix`       → `recipes/{ownerId}/`            ← the erasure sweep
 *
 * The first two would archive the same snapshot to two different objects. The third is the GDPR
 * account-erasure sweep, which only erases what lives under its prefix — so the other two are only
 * compliant *because* they happen to share it. `verticals-8` records that a key WITHOUT the owner
 * segment already escaped erasure once and survived a right-to-erasure request. That is a compliance
 * defect, and "they happen to agree" is not a guarantee — so the containment invariant is PINNED here
 * rather than left to convention.
 */
import { describe, it, expect } from 'vitest';

import { ownerMediaPrefix, recipeVersionArchiveKey } from '../recipeObjectKeys.js';

const OWNER = '01JOWNER0000000000000000A';
const RECIPE = '00000000-0000-4000-8000-0000000000r1';

describe('ownerMediaPrefix', () => {
    it('is the owner-scoped prefix the GDPR erasure sweep lists and deletes', () => {
        expect(ownerMediaPrefix(OWNER)).toBe(`recipes/${OWNER}/`);
    });

    it('ends with a slash so it can never match a sibling owner by prefix', () => {
        // Without the trailing delimiter, `recipes/{ownerId}` would also match `recipes/{ownerId}2/…`
        // on an S3 ListObjectsV2 prefix scan — erasing (or counting) another user's objects.
        expect(ownerMediaPrefix(OWNER).endsWith('/')).toBe(true);
        expect(ownerMediaPrefix('a').startsWith(ownerMediaPrefix('ab'))).toBe(false);
        expect(ownerMediaPrefix('ab').startsWith(ownerMediaPrefix('a'))).toBe(false);
    });

    it('separates owners', () => {
        expect(ownerMediaPrefix('owner-a')).not.toBe(ownerMediaPrefix('owner-b'));
    });
});

describe('recipeVersionArchiveKey', () => {
    it('addresses a version by its CLIENT-FACING number, not the internal row id', () => {
        // versionNumber is how the API addresses a version (GET /v1/recipes/{id}/versions/{n}) and is
        // unique within a recipe via the (recipe_id, version_number) index — so it is both collision-free
        // and debuggable. The worker previously keyed on the version UUID; the service's scheme wins.
        expect(recipeVersionArchiveKey({ ownerId: OWNER, recipeId: RECIPE, versionNumber: 3 })).toBe(
            `recipes/${OWNER}/${RECIPE}/versions/3.json`,
        );
    });

    it('gives each version of a recipe its own immutable object', () => {
        const v1 = recipeVersionArchiveKey({ ownerId: OWNER, recipeId: RECIPE, versionNumber: 1 });
        const v2 = recipeVersionArchiveKey({ ownerId: OWNER, recipeId: RECIPE, versionNumber: 2 });

        expect(v1).not.toBe(v2);
    });

    it('separates recipes within one owner', () => {
        const a = recipeVersionArchiveKey({ ownerId: OWNER, recipeId: 'rec-a', versionNumber: 1 });
        const b = recipeVersionArchiveKey({ ownerId: OWNER, recipeId: 'rec-b', versionNumber: 1 });

        expect(a).not.toBe(b);
    });
});

describe('the GDPR containment invariant (verticals-8)', () => {
    it('puts EVERY archive key under its owner erasure prefix', () => {
        // THE load-bearing assertion of this module. Account erasure sweeps exactly
        // `ownerMediaPrefix(ownerId)`; an archive key outside it survives a right-to-erasure request —
        // which is precisely the defect verticals-8 recorded. Any future change to either function that
        // breaks containment fails here instead of in a compliance audit.
        const cases = [
            { ownerId: OWNER, recipeId: RECIPE, versionNumber: 1 },
            { ownerId: '01JOTHER000000000000000B', recipeId: 'rec-x', versionNumber: 42 },
            { ownerId: 'a', recipeId: 'b', versionNumber: 999 },
        ];

        for (const parts of cases) {
            expect(recipeVersionArchiveKey(parts).startsWith(ownerMediaPrefix(parts.ownerId))).toBe(true);
        }
    });

    it("does not place one owner's archive under another owner's prefix", () => {
        const key = recipeVersionArchiveKey({ ownerId: 'owner-a', recipeId: RECIPE, versionNumber: 1 });

        expect(key.startsWith(ownerMediaPrefix('owner-b'))).toBe(false);
    });
});
