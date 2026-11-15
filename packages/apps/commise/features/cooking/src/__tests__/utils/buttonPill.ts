import { allIn } from '@commise/ui/testing/button-pill';

/**
 * @param control - A control, found by its role.
 * @returns The tallest min-height the control or any part of it holds, in px: a quiet button paints no pill, so its
 *     height is read from whichever element carries it.
 */
export const tallestMinHeight = (control: HTMLElement): number =>
    Math.max(...allIn(control).map((el) => Number.parseFloat(getComputedStyle(el).minHeight) || 0));
