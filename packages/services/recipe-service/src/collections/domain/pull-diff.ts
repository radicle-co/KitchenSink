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
 * ── WHY THE SHAPE IS IMPORTED AND NOT DECLARED HERE ──
 *
 * `PullDiff` is a PUBLIC RESPONSE BODY (`previewPullFromSource`) and a PUBLIC REQUEST BODY (the
 * `previewedDiff` echoed back on commit), so the CONTRACT owns it — `../collections.schema.ts`. It used to be
 * declared here, which meant a domain internal defined the wire type and the response imported *up* from the
 * domain. Computing a value does not confer ownership of its type; this module now imports the shape it must
 * PRODUCE. That also collapses what were four independent declarations of one thing (here, the controller's
 * request zod, the typed client's `types.ts`, and a second zod inside the client) into one.
 *
 * @module
 */
import type { PullDiff } from '../collections.schema.js';

export type { PullDiff };

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
