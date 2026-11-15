/**
 * The wizard's cursor over the items of a bulk import.
 *
 * DESIGN PATTERN: **State reducer** — pure functions from one position to the next, naming the ONE mark each move makes. Name
 * no route.
 *
 *  - `nextItem` marks the item reviewed and moves on; `skipItem` marks it skipped and moves on.
 *  - Past the last item the position is `done`. `backItem` leaves `done` for the last item and stops at the first.
 *  - `openItem` jumps to an item in range and ignores anything else.
 *  - Moving never changes a mark except for the item being left by `nextItem` and `skipItem`.
 *
 * ⚠️ The cursor carries a POSITION AND THE COUNT, not one mark per item. A file of any size is accepted (owner ruling,
 * ADR-0072 §8), so a cursor holding an array as long as the file would let a hostile `expectedTotal` allocate it; a move
 * returns the single mark it makes and the store writes that one row.
 *
 * The stored form is `recipe_imports.cursor_ordinal`: an item's ordinal, or the count itself for done.
 */
import type { ItemReview } from './importBindingPolicy.js';

/** Where the cook is. */
export type CursorPosition = { readonly kind: 'at'; readonly index: number } | { readonly kind: 'done' };

/** The one mark a move makes. */
interface CursorMark {
    readonly index: number;
    readonly review: ItemReview;
}

/** The result of a move: the new position, and the mark to write (none for a move that marks nothing). */
export interface CursorMove {
    readonly position: CursorPosition;
    readonly mark: CursorMark | undefined;
}

const DONE: CursorPosition = { kind: 'done' };

/**
 * The position a fresh import starts at.
 *
 * @param count - How many items the file holds.
 * @returns The first item; done when there are none. Pure.
 */
export function startPosition(count: number): CursorPosition {
    return count > 0 ? { kind: 'at', index: 0 } : DONE;
}

/**
 * Mark the current item and move past it.
 *
 * @param position - Where the cook is.
 * @param count - How many items the file holds.
 * @param review - The mark for the item being left.
 * @returns The next position and the mark; nothing when already done. Pure.
 */
function leave(position: CursorPosition, count: number, review: ItemReview): CursorMove {
    if (position.kind === 'done') {
        return { position, mark: undefined };
    }

    const next = position.index + 1;

    return {
        position: next < count ? { kind: 'at', index: next } : DONE,
        mark: { index: position.index, review },
    };
}

/**
 * Mark the current item reviewed and move on.
 *
 * @param position - Where the cook is.
 * @param count - How many items the file holds.
 * @returns The move. Pure.
 */
export function nextItem(position: CursorPosition, count: number): CursorMove {
    return leave(position, count, 'reviewed');
}

/**
 * Mark the current item skipped and move on.
 *
 * @param position - Where the cook is.
 * @param count - How many items the file holds.
 * @returns The move. Pure.
 */
export function skipItem(position: CursorPosition, count: number): CursorMove {
    return leave(position, count, 'skipped');
}

/**
 * Move to the previous item, marking nothing.
 *
 * @param position - Where the cook is.
 * @param count - How many items the file holds.
 * @returns The previous position; unchanged at the first item or with no items. Pure.
 */
export function backItem(position: CursorPosition, count: number): CursorMove {
    if (position.kind === 'done') {
        return { position: count === 0 ? DONE : { kind: 'at', index: count - 1 }, mark: undefined };
    }

    return { position: position.index === 0 ? position : { kind: 'at', index: position.index - 1 }, mark: undefined };
}

/**
 * Jump to an item, marking nothing.
 *
 * @param position - Where the cook is.
 * @param count - How many items the file holds.
 * @param index - The item to open.
 * @returns The position there; unchanged when the index is not an item. Pure.
 */
export function openItem(position: CursorPosition, count: number, index: number): CursorMove {
    return {
        position: Number.isInteger(index) && index >= 0 && index < count ? { kind: 'at', index } : position,
        mark: undefined,
    };
}

/**
 * The position a stored `cursor_ordinal` means.
 *
 * @param ordinal - The column: an item's ordinal, or the count for done.
 * @param count - How many items the file holds.
 * @returns The position. Pure.
 */
export function positionOfOrdinal(ordinal: number, count: number): CursorPosition {
    return ordinal >= count ? DONE : { kind: 'at', index: ordinal };
}

/**
 * The `cursor_ordinal` a position is stored as.
 *
 * @param position - The position.
 * @param count - How many items the file holds.
 * @returns The ordinal; the count for done. Pure.
 */
export function ordinalOfPosition(position: CursorPosition, count: number): number {
    return position.kind === 'done' ? count : position.index;
}
