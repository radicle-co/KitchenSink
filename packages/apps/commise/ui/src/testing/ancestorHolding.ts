/**
 * @module testing/ancestorHolding — where a test finds a box by what it holds, not by how many boxes the styling
 * library nests around the control.
 */

/**
 * The nearest ancestor of `start` that also holds `held`.
 *
 * @param start - The element to climb from. It is never returned.
 * @param held - The element the box must contain.
 * @param what - What the box is, for the failure message.
 * @returns The nearest such ancestor.
 * @throws Error when no ancestor of `start` holds `held`.
 */
export function nearestAncestorHolding(start: HTMLElement, held: HTMLElement, what: string): HTMLElement {
    for (let box = start.parentElement; box !== null; box = box.parentElement) {
        if (box.contains(held)) {
            return box;
        }
    }

    throw new Error(`Expected an ancestor of the start to hold ${what}.`);
}
