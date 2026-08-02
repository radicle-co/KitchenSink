/**
 * The single authoritative S3 object-key scheme for recipe media (ARCH-BE-3).
 *
 * This is ONE piece of knowledge — where a recipe's objects live in S3 — and it is consumed from three
 * places that must never disagree: the recipe service (which archives version snapshots beyond the
 * FR-007b retention window), the version-archive worker (which does the same asynchronously, FR-007b-i),
 * and the account-erasure worker (which deletes an owner's objects wholesale for GDPR right-to-erasure,
 * C-007). Each previously built the key itself, and the service and worker had already drifted onto
 * different schemes (`versionNumber` vs the internal `versionId`), which would archive one snapshot to
 * two different objects.
 *
 * **The containment invariant.** Every per-object key MUST live under {@link ownerMediaPrefix}, because
 * erasure sweeps exactly that prefix and nothing else. A key outside it silently survives a
 * right-to-erasure request — the defect `verticals-8` recorded, where an owner-less
 * `recipes/{recipeId}/versions/…` key escaped the sweep. Keeping both functions here, with that
 * invariant pinned by `__tests__/recipeObjectKeys.test.ts`, is what makes the guarantee structural
 * rather than coincidental.
 *
 * Lives in `@kitchensink/recipe-core` because it is shared platform knowledge: `@kitchensink/recipe-service`
 * and `@kitchensink/recipe-workers` both depend on it, and neither may own it alone. Every function here
 * is pure.
 */

/** The addressable identity of one archived recipe version. */
export interface RecipeVersionArchiveKeyParts {
    /** The app-user ULID that owns the recipe (the version row's `createdBy` — mutations are owner-only). */
    readonly ownerId: string;
    /** The recipe the version belongs to. */
    readonly recipeId: string;
    /**
     * The 1-based, client-facing version number — NOT the internal `recipe_versions.id` UUID.
     *
     * This is the address the API exposes (`GET /api/v1/recipes/{id}/versions/{versionNumber}`) and it is
     * unique within a recipe via the `(recipe_id, version_number)` index, so it is collision-free while
     * staying legible in the bucket.
     */
    readonly versionNumber: number;
}

/**
 * The S3 key prefix under which ALL of an owner's recipe media lives — the exact prefix GDPR account
 * erasure lists and deletes.
 *
 * The trailing slash is load-bearing: an S3 `ListObjectsV2` prefix scan is a plain string match, so a
 * prefix without the delimiter (`recipes/{ownerId}`) would also match `recipes/{ownerId}2/…` and reach
 * into a different owner's objects.
 *
 * @param ownerId - The app-user ULID.
 * @returns The owner-scoped, slash-terminated prefix. Pure.
 */
export function ownerMediaPrefix(ownerId: string): string {
    return `recipes/${ownerId}/`;
}

/**
 * The S3 key prefix under which ALL of ONE recipe's media lives, for a given owner —
 * `recipes/{ownerId}/{recipeId}/`. This is the per-recipe erasure prefix: it covers BOTH the recipe's
 * photo objects ({@link recipePhotoKeyPrefix} = `…/{recipeId}/photos/`) AND its version-archive snapshots
 * ({@link recipeVersionArchiveKey} = `…/{recipeId}/versions/…`), because both live under `{recipeId}/`.
 *
 * **Why this exists (CR-002 / U3a).** GDPR erasure no longer sweeps the whole owner prefix: an owner may
 * keep truly-public + donated recipes, whose media MUST survive. So the sweep is scoped to exactly the
 * REMOVED recipes' prefixes — one call to this per removed recipe — rather than `ownerMediaPrefix` (which
 * would also delete a surviving public recipe's photos). Derived from {@link ownerMediaPrefix} by
 * appending, so containment under the owner prefix stays STRUCTURAL (a per-recipe key is still under the
 * owner prefix), pinned by `__tests__/recipeObjectKeys.test.ts`.
 *
 * The trailing slash is load-bearing for the same reason it is on {@link recipePhotoKeyPrefix}: it makes
 * `{recipeId}` a delimiter-terminated segment, so a prefix scan for recipe `r1` cannot also match recipe
 * `r10` (which shares the leading substring) and reach into a recipe that must be KEPT.
 *
 * @param ownerId - The app-user ULID that owns the recipe.
 * @param recipeId - The recipe whose entire media subtree (photos + version archives) is addressed.
 * @returns The owner+recipe-scoped, slash-terminated media prefix. Pure.
 */
export function recipeMediaPrefix(ownerId: string, recipeId: string): string {
    return `${ownerMediaPrefix(ownerId)}${recipeId}/`;
}

/**
 * The deterministic key for one immutable version-snapshot archive object.
 *
 * Guaranteed to start with {@link ownerMediaPrefix}`(parts.ownerId)` so the object is reachable by the
 * erasure sweep — see the module docstring's containment invariant.
 *
 * @param parts - The owner, recipe, and client-facing version number.
 * @returns The object key. Pure.
 */
export function recipeVersionArchiveKey(parts: RecipeVersionArchiveKeyParts): string {
    return `${ownerMediaPrefix(parts.ownerId)}${parts.recipeId}/versions/${parts.versionNumber}.json`;
}

/**
 * The S3 key prefix under which ALL of one recipe's photo objects live, for a given owner —
 * `recipes/{ownerId}/{recipeId}/photos/`.
 *
 * **Containment is structural, not coincidental.** The prefix is DERIVED from {@link ownerMediaPrefix}
 * (`recipes/{ownerId}/`) by appending, never re-spelled, so every photo key formed from it necessarily
 * begins with the owner erasure prefix — the exact guarantee the module docstring's containment invariant
 * requires. This is the ONE authoritative definition of where a recipe's photos live: the recipe service
 * builds original keys from it (`{prefix}{uuid}`) AND re-checks a client-echoed key against it at confirm,
 * so a photo original can never escape the GDPR account-erasure sweep. Previously the recipe service
 * hand-rolled this literal locally, so its containment under the erasure prefix was a coincidental string
 * match — if {@link ownerMediaPrefix} ever changed, photo originals would silently survive a
 * right-to-erasure request (the `verticals-8` defect). The invariant is pinned in
 * `__tests__/recipeObjectKeys.test.ts`.
 *
 * The trailing slash is load-bearing, for the same reason it is on {@link ownerMediaPrefix}: it makes the
 * prefix a delimiter-terminated segment so a `startsWith` scope check on `{recipeId}` cannot match a
 * sibling recipe by a shared leading substring.
 *
 * @param ownerId - The app-user ULID that owns the recipe.
 * @param recipeId - The recipe the photos belong to.
 * @returns The owner+recipe-scoped, slash-terminated photo-object prefix. Pure.
 */
export function recipePhotoKeyPrefix(ownerId: string, recipeId: string): string {
    return `${ownerMediaPrefix(ownerId)}${recipeId}/photos/`;
}

/**
 * The deterministic original-object key for one recipe photo, `{prefix}{objectId}` under
 * {@link recipePhotoKeyPrefix}. The server assigns `objectId` (an opaque UUID) — a client never supplies
 * it — and the key is guaranteed under {@link ownerMediaPrefix}`(ownerId)`, so the erasure sweep reaches
 * the original. See {@link recipePhotoKeyPrefix} for why containment is structural.
 *
 * @param ownerId - The app-user ULID that owns the recipe.
 * @param recipeId - The recipe the photo belongs to.
 * @param objectId - The server-assigned opaque object id (e.g. a UUID).
 * @returns The photo's original object key. Pure.
 */
export function recipePhotoOriginalKey(ownerId: string, recipeId: string, objectId: string): string {
    return `${recipePhotoKeyPrefix(ownerId, recipeId)}${objectId}`;
}

/**
 * The suffix that turns a recipe-photo original-object key into its thumbnail-variant key.
 *
 * `.thumb.jpg`, not a sibling folder, on purpose: the variant is DERIVED from the original key by
 * appending, which is what makes {@link recipePhotoThumbnailKey}'s containment structural rather than
 * coincidental (see below). The `.jpg` records the format the recipe service writes the thumbnail in;
 * because the resolved key is persisted per row (`recipe_photos.thumbnail_key`), never recomputed from
 * the format, the service can evolve the format without orphaning existing objects.
 */
export const RECIPE_PHOTO_THUMBNAIL_SUFFIX = '.thumb.jpg';

/**
 * The deterministic key for a recipe photo's thumbnail rendition (FOLLOW-UP-CR-001-A), placed BESIDE the
 * original by appending {@link RECIPE_PHOTO_THUMBNAIL_SUFFIX} to the original object key.
 *
 * **Containment is structural, not coincidental.** A recipe photo's original key is itself built under
 * {@link ownerMediaPrefix}`(ownerId)` (`recipes/{ownerId}/{recipeId}/photos/{uuid}`). Deriving the
 * thumbnail by *appending* to that key can only ever produce a longer string with the same leading
 * characters, so the thumbnail is under the owner's erasure prefix whenever the original is — appending
 * cannot remove a prefix. This is the ONE place the thumbnail key is formed, precisely so the GDPR
 * account-erasure sweep (which lists and deletes exactly {@link ownerMediaPrefix}) reaches the thumbnail
 * for free. A variant scheme that instead relocated the object (e.g. a `thumbnails/{uuid}` root outside
 * the owner segment) would recreate `verticals-8`: an object that survives a right-to-erasure request.
 * The containment invariant is pinned in `__tests__/recipeObjectKeys.test.ts`.
 *
 * @param originalPhotoKey - The recipe photo's original object key, itself under an owner prefix.
 * @returns The thumbnail object key — the original key plus the thumbnail suffix. Pure.
 */
export function recipePhotoThumbnailKey(originalPhotoKey: string): string {
    return `${originalPhotoKey}${RECIPE_PHOTO_THUMBNAIL_SUFFIX}`;
}
