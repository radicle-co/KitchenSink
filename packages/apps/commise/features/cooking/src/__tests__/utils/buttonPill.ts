/**
 * Reading the house Button on the native test lane: its `role="button"` element is the hit area, and the painted surface
 * (fill, edge, height) is the descendant that carries the corner radius. The same rule `ui`'s own Button tests use.
 */

/** Every element in `root`, itself first. */
const allIn = (root: HTMLElement): HTMLElement[] => [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];

/**
 * @param button - The control, found by its role.
 * @returns The painted pill: the element carrying the surface's radius.
 * @throws Error when the button paints no rounded surface.
 */
export function pillOf(button: HTMLElement): HTMLElement {
    const pill = allIn(button).find((el) => Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) > 0);

    if (pill === undefined) {
        throw new Error('The button paints no rounded surface.');
    }

    return pill;
}

/**
 * @param root - A control or region.
 * @returns How many design-system glyphs it draws (the lane stubs each as `data-commise-stub="icon"`).
 */
export const glyphCount = (root: HTMLElement): number => root.querySelectorAll('[data-commise-stub="icon"]').length;

/**
 * @param control - A control, found by its role.
 * @returns The tallest min-height the control or any part of it holds, in px: a quiet button paints no pill, so its
 *     height is read from whichever element carries it.
 */
export const tallestMinHeight = (control: HTMLElement): number =>
    Math.max(...allIn(control).map((el) => Number.parseFloat(getComputedStyle(el).minHeight) || 0));
