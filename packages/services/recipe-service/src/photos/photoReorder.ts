/**
 * The pure rule for a valid photo reorder request: the requested id list must be an EXACT reordering of
 * the recipe's current photos — every current photo present, none missing, none extra/foreign, and no
 * duplicates. Anything else would leave some `sortOrder` values stale and collide (two photos at the
 * same position), corrupting the display order.
 *
 * Because a recipe's photo ids are unique (PK), an exact permutation reduces to three checks: equal
 * length, no duplicates in the request, and every requested id belongs to the current set. Pure.
 */
export function isExactReorder(currentIds: readonly string[], requestedIds: readonly string[]): boolean {
    if (currentIds.length !== requestedIds.length) {
        return false;
    }

    const requestedSet = new Set(requestedIds);

    // A duplicate in the request collapses the set below the array length.
    if (requestedSet.size !== requestedIds.length) {
        return false;
    }

    const currentSet = new Set(currentIds);

    // Equal length + no request duplicates + every requested id is current ⇒ exact permutation.
    return requestedIds.every((id) => currentSet.has(id));
}
