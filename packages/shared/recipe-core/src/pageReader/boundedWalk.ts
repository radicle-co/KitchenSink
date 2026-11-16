/**
 * The one bounded, iterative walk the page reader uses over parsed JSON-LD, schema.org instructions and microdata.
 *
 * DESIGN PATTERN: **Iterator** (an explicit stack, so depth costs memory and never the call stack) with the **Visitor**
 * handing each node's children back to the walk. It owns the count, the node cap and the depth cap, so no walker repeats
 * them, and it SAYS when a cap cut the walk short: a caller that reads a page never judges it against half of itself
 * (`pageCaps.ts`).
 */
import { MAX_WALK_DEPTH, MAX_WALK_NODES } from './pageCaps.js';

/** How a walk ended. */
export interface WalkOutcome {
    /** Whether {@link MAX_WALK_NODES} or {@link MAX_WALK_DEPTH} left a node unread. */
    readonly truncated: boolean;
}

interface Frame<T> {
    readonly item: T;
    readonly depth: number;
}

/**
 * Walk `roots` depth first, in order.
 *
 * ⛔ At most {@link MAX_WALK_NODES} nodes are visited. A node deeper than {@link MAX_WALK_DEPTH} is not visited and its
 * children are never read; the walk goes on with the nodes that remain.
 *
 * @param roots - The first nodes, in order.
 * @param visit - Called once per node with its depth. It returns the children to walk next, in order (none to stop
 *   descending). It may keep its own state.
 * @param startDepth - The depth of `roots`.
 * @returns Whether a cap cut the walk short.
 * @sideEffect Calls `visit`, which may mutate what it closes over.
 */
export function boundedWalk<T>(
    roots: readonly T[],
    visit: (item: T, depth: number) => readonly T[],
    startDepth = 0,
): WalkOutcome {
    const stack: Frame<T>[] = [];

    const pushAll = (items: readonly T[], depth: number): void => {
        for (let index = items.length - 1; index >= 0; index -= 1) {
            stack.push({ item: items[index], depth });
        }
    };

    let visited = 0;
    let skippedForDepth = false;

    pushAll(roots, startDepth);

    for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
        visited += 1;

        if (visited > MAX_WALK_NODES) {
            return { truncated: true };
        }

        if (frame.depth > MAX_WALK_DEPTH) {
            skippedForDepth = true;
            continue;
        }

        pushAll(visit(frame.item, frame.depth), frame.depth + 1);
    }

    return { truncated: skippedForDepth };
}
