/**
 * @module @commise/ui/testing — the native test lane's reader of the house Button. Its `role="button"` element is the
 * hit area, and the painted surface (fill, edge, height) is the descendant that carries the corner radius. `ui`'s own
 * Button tests and every feature that asserts on a Button's pill read it through here, so the rule has one home.
 */

/**
 * @param root - A control or region.
 * @returns Every element in `root`, itself first.
 */
export const allIn = (root: HTMLElement): HTMLElement[] => [
    root,
    ...Array.from(root.querySelectorAll<HTMLElement>('*')),
];

/**
 * @param button - The control, found by its role.
 * @returns The painted pill: the element carrying the surface's radius.
 * @throws Error when the button paints no rounded surface.
 */
export function pillOf(button: HTMLElement): HTMLElement {
    const pill = allIn(button).find((el) => Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) > 0);

    if (pill === undefined) {
        throw new Error('The button paints no surface with a corner radius.');
    }

    return pill;
}

/**
 * @param root - A control or region.
 * @returns How many design-system glyphs it draws (the lane stubs each as `data-commise-stub="icon"`).
 */
export const glyphCount = (root: HTMLElement): number => root.querySelectorAll('[data-commise-stub="icon"]').length;
