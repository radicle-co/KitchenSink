/**
 * @module testing/filledBox — where a test finds the one box that carries a fill, by the fill and not by how many boxes
 * the styling library nests around it.
 */
import { resolvedColour } from './tamaguiTesting.native.js';

/**
 * The nearest box, from `start` outward, that paints `fill` as its background.
 *
 * @param start - The element to climb from. It may be the box itself.
 * @param fill - The background colour as `rgb(…)`.
 * @param what - What the box is, for the failure message.
 * @returns The box.
 * @throws Error when no box from `start` outward paints that fill.
 */
export function filledBoxOf(start: HTMLElement, fill: string, what: string): HTMLElement {
    for (let box: HTMLElement | null = start; box !== null; box = box.parentElement) {
        if (resolvedColour(box, 'backgroundColor') === fill) {
            return box;
        }
    }

    throw new Error(`Expected a box painting ${fill} around ${what}.`);
}
