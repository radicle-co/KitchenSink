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

import {
    ownerMediaPrefix,
    recipeMediaPrefix,
    recipePhotoKeyPrefix,
    recipePhotoOriginalKey,
    recipePhotoThumbnailKey,
    RECIPE_PHOTO_THUMBNAIL_SUFFIX,
    recipeVersionArchiveKey,
} from '../recipeObjectKeys.js';

const OWNER = '01JOWNER0000000000000000A';
const RECIPE = '00000000-0000-4000-8000-0000000000r1';
const OBJECT_ID = 'e2b1a0c0-0000-4000-8000-000000000abc';

/**
 * A recipe-photo original object key, built from the SAME authoritative helper the service uses. Pinning
 * containment against this (not a re-spelled literal) is what makes the guarantee structural: a change to
 * `ownerMediaPrefix`/`recipePhotoKeyPrefix` that broke containment fails the containment describe below.
 */
const photoKey = (ownerId: string, recipeId = RECIPE, objectId = OBJECT_ID): string =>
    recipePhotoOriginalKey(ownerId, recipeId, objectId);

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
        // versionNumber is how the API addresses a version (GET /api/v1/recipes/{id}/versions/{n}) and is
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

describe('recipePhotoKeyPrefix / recipePhotoOriginalKey', () => {
    it('derives the photo prefix from the owner erasure prefix by appending (not re-spelling it)', () => {
        // The prefix MUST be built on top of ownerMediaPrefix so containment is structural. Asserting the
        // exact composition (ownerMediaPrefix + `{recipeId}/photos/`) fails if the helper stops deriving
        // from ownerMediaPrefix — the coincidental-string-match regression this fix removes.
        expect(recipePhotoKeyPrefix(OWNER, RECIPE)).toBe(`${ownerMediaPrefix(OWNER)}${RECIPE}/photos/`);
        expect(recipePhotoKeyPrefix(OWNER, RECIPE)).toBe(`recipes/${OWNER}/${RECIPE}/photos/`);
    });

    it('ends with a slash so a scope check cannot match a sibling recipe by prefix', () => {
        expect(recipePhotoKeyPrefix(OWNER, RECIPE).endsWith('/')).toBe(true);
        // recipe `r1` must not be a prefix of recipe `r10`'s photo space (delimiter guards the boundary).
        expect(recipePhotoKeyPrefix(OWNER, 'r1').startsWith(recipePhotoKeyPrefix(OWNER, 'r10'))).toBe(false);
        expect(recipePhotoKeyPrefix(OWNER, 'r10').startsWith(recipePhotoKeyPrefix(OWNER, 'r1'))).toBe(false);
    });

    it('composes the original key as the prefix plus the server-assigned object id', () => {
        expect(recipePhotoOriginalKey(OWNER, RECIPE, OBJECT_ID)).toBe(
            `${recipePhotoKeyPrefix(OWNER, RECIPE)}${OBJECT_ID}`,
        );
    });

    it('separates recipes within one owner and owners from each other', () => {
        expect(recipePhotoKeyPrefix(OWNER, 'rec-a')).not.toBe(recipePhotoKeyPrefix(OWNER, 'rec-b'));
        expect(recipePhotoKeyPrefix('owner-a', RECIPE)).not.toBe(recipePhotoKeyPrefix('owner-b', RECIPE));
    });
});

describe('recipeMediaPrefix (CR-002 / U3a — the per-removed-recipe erasure prefix)', () => {
    it('derives ONE recipe’s media prefix from the owner erasure prefix by appending {recipeId}/', () => {
        // The per-recipe sweep must stay UNDER the owner prefix (containment), so it is built on top of
        // ownerMediaPrefix, never re-spelled. Asserting the exact composition fails if it stops deriving.
        expect(recipeMediaPrefix(OWNER, RECIPE)).toBe(`${ownerMediaPrefix(OWNER)}${RECIPE}/`);
        expect(recipeMediaPrefix(OWNER, RECIPE)).toBe(`recipes/${OWNER}/${RECIPE}/`);
    });

    it('covers BOTH the recipe’s photos AND its version archives (the whole {recipeId}/ subtree)', () => {
        // The scoped erasure sweeps this prefix per removed recipe, so it must contain the photo prefix
        // (…/{recipeId}/photos/) and the version-archive keys (…/{recipeId}/versions/…). If it didn't, a
        // removed recipe's version snapshots — full recipe PII — would survive the scoped sweep.
        expect(recipePhotoKeyPrefix(OWNER, RECIPE).startsWith(recipeMediaPrefix(OWNER, RECIPE))).toBe(true);
        expect(
            recipeVersionArchiveKey({ ownerId: OWNER, recipeId: RECIPE, versionNumber: 3 }).startsWith(
                recipeMediaPrefix(OWNER, RECIPE),
            ),
        ).toBe(true);
    });

    it('ends with a slash so sweeping recipe r1 can never reach kept recipe r10’s media', () => {
        // THE safety property of the scoped sweep: recipe `r1` must not be a prefix of recipe `r10`, or
        // erasing a removed r1 would also delete a KEPT r10's objects (a truly-public recipe losing its
        // photos to another recipe's erasure).
        expect(recipeMediaPrefix(OWNER, RECIPE).endsWith('/')).toBe(true);
        expect(recipeMediaPrefix(OWNER, 'r1').startsWith(recipeMediaPrefix(OWNER, 'r10'))).toBe(false);
        expect(recipeMediaPrefix(OWNER, 'r10').startsWith(recipeMediaPrefix(OWNER, 'r1'))).toBe(false);
    });

    it('stays strictly UNDER the owner prefix but is NOT the owner prefix itself (never sweeps owner-wide)', () => {
        // If a per-recipe prefix ever collapsed to the owner-wide `recipes/{owner}/`, the scoped sweep
        // would delete every KEPT recipe's media too — the exact regression U3a prevents.
        expect(recipeMediaPrefix(OWNER, RECIPE).startsWith(ownerMediaPrefix(OWNER))).toBe(true);
        expect(recipeMediaPrefix(OWNER, RECIPE)).not.toBe(ownerMediaPrefix(OWNER));
        expect(recipeMediaPrefix(OWNER, RECIPE).length).toBeGreaterThan(ownerMediaPrefix(OWNER).length);
    });

    it('separates recipes within one owner and owners from each other', () => {
        expect(recipeMediaPrefix(OWNER, 'rec-a')).not.toBe(recipeMediaPrefix(OWNER, 'rec-b'));
        expect(recipeMediaPrefix('owner-a', RECIPE)).not.toBe(recipeMediaPrefix('owner-b', RECIPE));
    });
});

describe('recipePhotoThumbnailKey', () => {
    it('derives the thumbnail as a distinct sibling BESIDE the original object (append, not relocate)', () => {
        const original = photoKey(OWNER);
        const thumbnail = recipePhotoThumbnailKey(original);

        // Appended, not moved: the thumbnail extends the original key rather than living under a new root.
        // That is what makes containment structural (see the containment describe below).
        expect(thumbnail).toBe(`${original}${RECIPE_PHOTO_THUMBNAIL_SUFFIX}`);
        expect(thumbnail.startsWith(original)).toBe(true);
        // A distinct object — the thumbnail must never collide with the full-size original.
        expect(thumbnail).not.toBe(original);
    });

    it('records the .jpg format the service writes the rendition in', () => {
        expect(recipePhotoThumbnailKey(photoKey(OWNER)).endsWith('.thumb.jpg')).toBe(true);
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

    it('puts EVERY photo ORIGINAL key under its owner erasure prefix', () => {
        // The recipe service builds photo original keys from recipePhotoKeyPrefix AND serves them as-is via
        // CloudFront; if that prefix ever escaped ownerMediaPrefix, a photo original would survive a
        // right-to-erasure request (verticals-8). A mutation that re-rooted the photo prefix (e.g. a bucket
        // -level `photos/{recipeId}/…`) fails here.
        const owners = [OWNER, '01JOTHER000000000000000B', 'a'];

        for (const ownerId of owners) {
            const original = recipePhotoOriginalKey(ownerId, RECIPE, OBJECT_ID);

            expect(original.startsWith(ownerMediaPrefix(ownerId))).toBe(true);
        }
    });

    it('puts EVERY photo-thumbnail key under its owner erasure prefix (FOLLOW-UP-CR-001-A)', () => {
        // The thumbnail rendition is a new owner-scoped object, so it is subject to the SAME containment
        // guarantee as the archive: the erasure sweep only reaches what lives under `ownerMediaPrefix`, so
        // a thumbnail key that escaped it would survive a right-to-erasure request — the verticals-8
        // defect, reintroduced. A mutation that relocated the thumbnail off the original key (e.g.
        // `thumbnails/{uuid}` at the bucket root) fails here.
        const owners = [OWNER, '01JOTHER000000000000000B', 'a'];

        for (const ownerId of owners) {
            const thumbnail = recipePhotoThumbnailKey(photoKey(ownerId));

            expect(thumbnail.startsWith(ownerMediaPrefix(ownerId))).toBe(true);
        }
    });

    it("does not place one owner's archive under another owner's prefix", () => {
        const key = recipeVersionArchiveKey({ ownerId: 'owner-a', recipeId: RECIPE, versionNumber: 1 });

        expect(key.startsWith(ownerMediaPrefix('owner-b'))).toBe(false);
    });

    it("does not place one owner's photo thumbnail under another owner's prefix", () => {
        const thumbnail = recipePhotoThumbnailKey(photoKey('owner-a'));

        expect(thumbnail.startsWith(ownerMediaPrefix('owner-b'))).toBe(false);
    });
});
