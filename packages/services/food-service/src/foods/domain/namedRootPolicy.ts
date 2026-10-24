/**
 * What a remote pick does with the live catalog root that already carries the picked name (ADR-0055 point 10). A
 * catalog name is unique among live roots (0018), so that root is the answer for the name, and the only question is
 * whether it holds a record:
 *
 * - `RESOLVED` holds one: the pick answers it, and nothing is fetched.
 * - Every other catalog status is a placeholder with no record (queued, retrying, awaiting disambiguation, found
 *   nowhere, or failed): the pick completes it with the picked item, so a line bound to it gains the data and no cook's
 *   pick is bound to a root with none. `RESOLVED` is not reachable from `NOT_FOUND` or `FAILED` (FR-028a's legal
 *   moves), so those are reactivated to `PENDING` first, as add-by-name reactivates a stale tombstone.
 *
 * The search hides a remote hit by the same answer ({@link answersItsName}), so it never shows a hit whose pick would
 * answer with a root already in the catalog (R66).
 *
 * @pattern Specification — one pure rule from a root's status to the pick's action
 * @module
 */
import type { FoodStatus } from '../dao/food.dao.js';

/** What the pick does with the named root. */
export type NamedRootAction =
    | { readonly kind: 'answer' }
    | {
          readonly kind: 'complete';
          /** The terminal status to reactivate to `PENDING` before the record is written, if any. */
          readonly reactivateFrom: 'NOT_FOUND' | 'FAILED' | undefined;
      };

/**
 * The pick's action for a named root's status. Pure.
 *
 * @param status - The root's status.
 * @returns Answer it, or complete it.
 * @throws {Error} for `DELETING` and `WITHDRAWN`: only an authored food reaches either, and an authored food holds no
 *   catalog name, so either here is a defect.
 */
export function namedRootActionOf(status: FoodStatus): NamedRootAction {
    switch (status) {
        case 'RESOLVED':
            return { kind: 'answer' };
        case 'PENDING':
        case 'AWAITING_RETRY':
        case 'UNRESOLVED':
            return { kind: 'complete', reactivateFrom: undefined };
        case 'NOT_FOUND':
        case 'FAILED':
            return { kind: 'complete', reactivateFrom: status };
        case 'DELETING':
        case 'WITHDRAWN':
            throw new Error(`A catalog name is held by a root in ${status}, which only an authored food reaches.`);
    }
}

/**
 * Whether the live catalog root carrying a name answers it: {@link namedRootActionOf} answers rather than completes. A
 * remote hit such a root answers is hidden from search (R66), and a pick of it answers that root. Pure.
 *
 * @param status - The root's status.
 * @returns `true` when the root holds a record.
 * @throws {Error} as {@link namedRootActionOf} does.
 */
export function answersItsName(status: FoodStatus): boolean {
    return namedRootActionOf(status).kind === 'answer';
}
