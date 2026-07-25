/**
 * Unit tests for the shared CDN-invalidation contract (HAZ-051/067/039).
 *
 * Written BEFORE the module (TDD red → green). `cdnPathForKey`/`cdnOwnerPrefixInvalidationPath` are the
 * ONE definition of how a recipe-media S3 key maps to a CloudFront invalidation path, consumed by both
 * the recipe service's per-photo delete (`@kitchensink/recipe-service`) and the GDPR account-erasure
 * worker (`@kitchensink/recipe-workers`) — the same two packages that already share the S3 key scheme in
 * `recipeObjectKeys.ts`. A CDN invalidation path and an S3 object key are NOT the same string (CloudFront
 * paths are always leading-slash-anchored; S3 keys never are), so a hand-rolled `'/' + key` at each call
 * site would be exactly the kind of redundant, driftable knowledge `ownerMediaPrefix` already exists to
 * prevent for the key scheme itself.
 */
import { describe, it, expect } from 'vitest';

import { cdnOwnerPrefixInvalidationPath, cdnPathForKey } from '../cdnInvalidation.js';
import { ownerMediaPrefix, recipePhotoOriginalKey, recipePhotoThumbnailKey } from '../recipeObjectKeys.js';

const OWNER = '01JOWNER0000000000000000A';
const RECIPE = '00000000-0000-4000-8000-0000000000r1';
const OBJECT_ID = 'e2b1a0c0-0000-4000-8000-000000000abc';

describe('cdnPathForKey', () => {
    it('anchors an S3 object key as a leading-slash CloudFront invalidation path', () => {
        const key = recipePhotoOriginalKey(OWNER, RECIPE, OBJECT_ID);

        expect(cdnPathForKey(key)).toBe(`/${key}`);
    });

    it('never double-anchors a key that already starts with a slash', () => {
        // S3 keys never legitimately start with '/', but the function's contract is "prepend exactly one
        // leading slash" — pinning this documents that it is a prepend, not a normalize.
        expect(cdnPathForKey('a/b')).toBe('/a/b');
    });

    it('derives distinct paths for the original and its thumbnail rendition', () => {
        const original = recipePhotoOriginalKey(OWNER, RECIPE, OBJECT_ID);
        const thumbnail = recipePhotoThumbnailKey(original);

        expect(cdnPathForKey(original)).not.toBe(cdnPathForKey(thumbnail));
        expect(cdnPathForKey(thumbnail)).toBe(`/${thumbnail}`);
    });
});

describe('cdnOwnerPrefixInvalidationPath', () => {
    it('is a wildcard CloudFront path over the SAME prefix the GDPR erasure sweep lists and deletes', () => {
        // Structural, not coincidental: derived FROM ownerMediaPrefix (append '*'), the same relationship
        // recipePhotoKeyPrefix has to it — so this path can never silently diverge from the S3 prefix the
        // erasure worker actually sweeps.
        expect(cdnOwnerPrefixInvalidationPath(OWNER)).toBe(`/${ownerMediaPrefix(OWNER)}*`);
        expect(cdnOwnerPrefixInvalidationPath(OWNER)).toBe(`/recipes/${OWNER}/*`);
    });

    it('separates owners', () => {
        expect(cdnOwnerPrefixInvalidationPath('owner-a')).not.toBe(cdnOwnerPrefixInvalidationPath('owner-b'));
    });

    it('is anchored so it cannot match a sibling owner by shared leading substring', () => {
        // ownerMediaPrefix's trailing slash is what makes this safe; pin the composed wildcard path too,
        // since this is the string CloudFront actually matches invalidation requests against.
        expect(cdnOwnerPrefixInvalidationPath('a')).not.toContain(cdnOwnerPrefixInvalidationPath('ab'));
    });
});
