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
     * This is the address the API exposes (`GET /v1/recipes/{id}/versions/{versionNumber}`) and it is
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
