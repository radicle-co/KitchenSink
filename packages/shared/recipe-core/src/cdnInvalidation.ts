/**
 * The CDN-invalidation contract shared across BOTH S3-delete points that must also purge the CloudFront
 * edge cache for recipe media (HAZ-051/067/039): the recipe service's per-photo delete
 * (`@kitchensink/recipe-service`) and the recipe-workers GDPR account-erasure sweep
 * (`@kitchensink/recipe-workers`).
 *
 * Recipe photos are served through an EXTERNAL CloudFront distribution (no `Distribution` construct
 * exists in this repo's CDK — see `photos.module.ts`'s `cloudfrontUrl` config), and deleting the S3
 * origin object does NOT purge anything already cached at a CloudFront edge location. Without an explicit
 * invalidation, a deleted or erased photo can keep being served from the CDN until the object's TTL
 * expires — a real residual-exposure window for a right-to-erasure request or an ordinary photo delete.
 *
 * Two pieces of knowledge live here, for the same reason {@link ownerMediaPrefix}'s producer/consumer
 * split does: a contract declared separately by each side is a contract that drifts.
 *  - {@link CdnInvalidationPort} — the narrow "issue an invalidation for these paths" seam BOTH packages
 *    implement their own real (`@aws-sdk/client-cloudfront`) adapter against, mirroring how each package
 *    already implements its own S3 adapter rather than sharing one (recipe-service's `PhotoStoragePort` /
 *    `photos.storage.ts` vs recipe-workers' direct `S3Client` calls in `accountErasureWorker.ts`) — the
 *    two packages are different runtimes (a NestJS DI app vs plain Lambda handlers), so the CONTRACT is
 *    shared here while each adapter stays local to its own dependency-injection/construction style.
 *  - {@link cdnPathForKey} / {@link cdnOwnerPrefixInvalidationPath} — pure derivations from the SAME S3
 *    key scheme `recipeObjectKeys.ts` already owns, so a CDN invalidation path can never independently
 *    drift from the S3 prefix the erasure sweep actually deletes.
 */
import { ownerMediaPrefix } from './recipeObjectKeys.js';

/**
 * The narrow CDN-invalidation seam both packages' real adapters implement (against
 * `@aws-sdk/client-cloudfront`'s `CreateInvalidationCommand`) and both packages' tests fake.
 */
export interface CdnInvalidationPort {
    /**
     * Issue a CDN invalidation for the given CloudFront paths (each leading-slash-anchored; a path may end
     * in a `*` wildcard). Implementations MUST no-op (never throw) when no distribution is configured —
     * see each adapter's own doc for the exact unset-distribution contract.
     *
     * @sideEffect Issues a CloudFront `CreateInvalidation` request (real adapters) or writes a log line
     *   (the unset-distribution no-op adapter).
     */
    invalidate(paths: string[]): Promise<void>;
}

/**
 * The CloudFront invalidation path for ONE recipe-media S3 object key: the key, anchored with a leading
 * slash. CloudFront invalidation paths are always slash-anchored; S3 object keys never are — so this
 * (trivial-looking) prepend is the one place that fact is encoded, rather than re-spelled at each call
 * site. Pure.
 *
 * @param key - A recipe-media S3 object key (e.g. a photo original or its thumbnail rendition).
 * @returns The CloudFront invalidation path for that object.
 */
export function cdnPathForKey(key: string): string {
    return `/${key}`;
}

/**
 * The CloudFront wildcard invalidation path covering an owner's ENTIRE recipe-media prefix —
 * `/recipes/{ownerId}/*`. Used by GDPR account erasure, where invalidating one path per object would be
 * both more expensive and no more correct than a single wildcard over the same prefix the S3 sweep
 * ({@link ownerMediaPrefix}) already deletes by.
 *
 * Derived from {@link ownerMediaPrefix} by appending — never re-spelled — so this path can never
 * independently drift from the exact prefix the erasure sweep sweeps: the same structural-containment
 * relationship `recipePhotoKeyPrefix` has to `ownerMediaPrefix` (see `recipeObjectKeys.ts`). Pure.
 *
 * @param ownerId - The app-user ULID being erased.
 * @returns The wildcard CloudFront invalidation path for the owner's whole media prefix.
 */
export function cdnOwnerPrefixInvalidationPath(ownerId: string): string {
    return `/${ownerMediaPrefix(ownerId)}*`;
}
