/**
 * @module @commise/features-recipes/form — where a step's index goes when the steps move or one is removed. The Steps
 * leaves key a revealed-but-empty timer by index (a draft step has no identity of its own), so the disclosure is
 * re-keyed in the same handler that moves or removes the step, and follows it.
 *
 * The same goes for focus after a ⋯ Remove: the control that should take it is found from the index.
 *
 * Pure and platform-agnostic: shared by the web and native Steps leaves.
 */

/**
 * The index a step at `index` has after the step at `from` moves to `to`. Pure.
 *
 * @param index - A step's index before the move.
 * @param from - The moved step's index.
 * @param to - Where it moved.
 * @returns The step's index after the move.
 */
export function indexAfterMove(index: number, from: number, to: number): number {
    if (index === from) {
        return to;
    }

    if (from < to && index > from && index <= to) {
        return index - 1;
    }

    if (from > to && index >= to && index < from) {
        return index + 1;
    }

    return index;
}

/**
 * The index a step at `index` has after the step at `removed` is removed. Pure.
 *
 * @param index - A step's index before the removal.
 * @param removed - The removed step's index.
 * @returns The step's index after it, or `undefined` for the removed step itself.
 */
export function indexAfterRemove(index: number, removed: number): number | undefined {
    if (index === removed) {
        return undefined;
    }

    return index > removed ? index - 1 : index;
}

/** A control that can take a requested focus: one step's ⋯, or Add step. */
export type StepFocusTarget = { readonly kind: 'actions'; readonly index: number } | { readonly kind: 'add' };

/**
 * Where focus goes after the step at `index` is removed from `count` steps: the step that took its place, else the one
 * now last, else Add step. Pure.
 *
 * @param index - The removed step's index.
 * @param count - How many steps there were.
 * @returns The control to focus.
 */
export const focusAfterRemove = (index: number, count: number): StepFocusTarget =>
    count <= 1 ? { kind: 'add' } : { kind: 'actions', index: Math.min(index, count - 2) };
