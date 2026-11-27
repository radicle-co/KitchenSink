/**
 * @module testing/undoSnackbarParts — where a test finds the native Undo snackbar's boxes, by what they hold and not
 * by how deep the styling library nests them.
 */
import { present } from './present.js';

/**
 * The bar: the nearest ancestor of the message that also holds the Undo button.
 *
 * @param message - The message's text element.
 * @param undo - The Undo button.
 * @returns The bar.
 * @throws Error when no ancestor of the message holds the button.
 */
export function snackbarBarOf(message: HTMLElement, undo: HTMLElement): HTMLElement {
    for (let box = message.parentElement; box !== null; box = box.parentElement) {
        if (box.contains(undo)) {
            return box;
        }
    }

    throw new Error('Expected an ancestor of the message to hold the Undo button.');
}

/**
 * Undo's frame: the one box inside its button, which carries the press fill and the touch floor.
 *
 * @param undo - The Undo button.
 * @returns The frame.
 */
export function undoFrameOf(undo: HTMLElement): HTMLElement {
    return present(undo.querySelector<HTMLElement>(':scope > *'), "Undo's frame");
}
