/**
 * The wizard's cursor over the items of a bulk import.
 *
 * DESIGN PATTERN: **State reducer** — pure functions from one cursor to the next. The cursor OWNS the per-item
 * marks (pending, reviewed, skipped) because moving is what sets them, and the binding policy reads them. Name no route.
 *
 *  - `nextItem` marks the item reviewed and moves on; `skipItem` marks it skipped and moves on.
 *  - Past the last item the position is `done`. `backItem` leaves `done` for the last item and stops at the first.
 *  - `openItem` jumps to an item in range and ignores anything else.
 *  - Moving never changes a mark except for the item being left by `nextItem` and `skipItem`.
 */
import type { ItemReview } from './importBindingPolicy.js';

/** Where the cook is. */
export type CursorPosition = { readonly kind: 'at'; readonly index: number } | { readonly kind: 'done' };

/** A position and one mark per item. */
export interface ImportCursor {
    readonly position: CursorPosition;
    readonly reviews: readonly ItemReview[];
}

/**
 * Start at the first item, everything pending.
 *
 * @param count - How many items there are.
 * @returns The cursor; `done` when there are none. Pure.
 */
export function startCursor(count: number): ImportCursor {
    return {
        position: count > 0 ? { kind: 'at', index: 0 } : { kind: 'done' },
        reviews: Array.from({ length: count }, (): ItemReview => 'pending'),
    };
}

/**
 * Mark the current item and move past it.
 *
 * @param cursor - The cursor.
 * @param mark - The mark for the item being left.
 * @returns The next cursor; unchanged when done. Pure.
 */
function leave(cursor: ImportCursor, mark: ItemReview): ImportCursor {
    const { position } = cursor;

    if (position.kind === 'done') {
        return cursor;
    }

    const reviews = cursor.reviews.map((existing, index) => (index === position.index ? mark : existing));
    const nextIndex = position.index + 1;

    return {
        position: nextIndex < reviews.length ? { kind: 'at', index: nextIndex } : { kind: 'done' },
        reviews,
    };
}

/**
 * Mark the current item reviewed and move on.
 *
 * @param cursor - The cursor.
 * @returns The next cursor. Pure.
 */
export function nextItem(cursor: ImportCursor): ImportCursor {
    return leave(cursor, 'reviewed');
}

/**
 * Mark the current item skipped and move on.
 *
 * @param cursor - The cursor.
 * @returns The next cursor. Pure.
 */
export function skipItem(cursor: ImportCursor): ImportCursor {
    return leave(cursor, 'skipped');
}

/**
 * Move to the previous item, changing no mark.
 *
 * @param cursor - The cursor.
 * @returns The previous cursor; unchanged at the first item or with no items. Pure.
 */
export function backItem(cursor: ImportCursor): ImportCursor {
    const { position, reviews } = cursor;

    if (position.kind === 'done') {
        return reviews.length === 0 ? cursor : { ...cursor, position: { kind: 'at', index: reviews.length - 1 } };
    }

    return position.index === 0 ? cursor : { ...cursor, position: { kind: 'at', index: position.index - 1 } };
}

/**
 * Jump to an item, changing no mark.
 *
 * @param cursor - The cursor.
 * @param index - The item to open.
 * @returns The cursor there; unchanged when the index is not an item. Pure.
 */
export function openItem(cursor: ImportCursor, index: number): ImportCursor {
    return Number.isInteger(index) && index >= 0 && index < cursor.reviews.length
        ? { ...cursor, position: { kind: 'at', index } }
        : cursor;
}
