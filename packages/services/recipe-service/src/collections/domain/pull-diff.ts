/**
 * The pure pull-from-source diff (W8-a.8 / owner decision 7) — the SINGLE source of "what does pulling the
 * source into this clone change?", shared by BOTH the read-only preview endpoint and the mutating commit so
 * a drift check compares like-for-like.
 *
 * The diff is a three-way partition of `source ∪ clone`, computed over the caller's already-scoped
 * membership id lists (the DAL applies the visibility + status + tombstone predicate, so a source recipe
 * gone private/draft/deleted is simply absent from `sourceIds` and can never appear in `added`):
 *
 *   - **added**    = source \ clone — recipes the pull WILL add to the clone.
 *   - **unchanged** = source ∩ clone — already present; the pull is a no-op for these.
 *   - **removed**  = clone \ source — in the clone but not (any longer) in the source. INFORMATIONAL: a
 *     pull is additive and never deletes these; they are surfaced so the user sees the full relationship
 *     and so the drift check notices when the caller's own clone membership changed since the preview.
 *
 * Every bucket is de-duplicated and sorted, so an echoed preview and a live recomputation are byte-equal
 * whenever (and only whenever) neither the source nor the clone membership changed — which is exactly the
 * drift signal decision 7 relies on.
 *
 * @module
 */

/** The three-way pull diff (sorted, de-duplicated id lists). */
export interface PullDiff {
    /** Recipes in the source but not the clone — the pull WILL add these. */
    readonly added: string[];
    /** Recipes in the clone but not the source — informational; a pull never removes them. */
    readonly removed: string[];
    /** Recipes in both — already present; the pull is a no-op for these. */
    readonly unchanged: string[];
}

/**
 * Compute the {@link PullDiff} from the (already access-scoped) source and clone membership id lists. Pure.
 *
 * @param sourceIds - The source collection's viewable, published, active recipe ids (as the caller sees them).
 * @param cloneIds - The clone collection's viewable, published, active recipe ids.
 */
export function computePullDiff(sourceIds: readonly string[], cloneIds: readonly string[]): PullDiff {
    const source = new Set(sourceIds);
    const clone = new Set(cloneIds);

    const added: string[] = [];
    const unchanged: string[] = [];
    const removed: string[] = [];

    for (const id of source) {
        (clone.has(id) ? unchanged : added).push(id);
    }

    for (const id of clone) {
        if (!source.has(id)) {
            removed.push(id);
        }
    }

    return {
        added: added.sort(),
        removed: removed.sort(),
        unchanged: unchanged.sort(),
    };
}

/** Whether two pull diffs describe the same change (added + removed match — `unchanged` is derivable). Pure. */
export function pullDiffsAgree(a: PullDiff, b: PullDiff): boolean {
    return arraysEqual(a.added, b.added) && arraysEqual(a.removed, b.removed);
}

/** Element-wise equality of two already-sorted string arrays. Pure. */
function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}
