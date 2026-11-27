/**
 * @module components/home/chrome/mainColumn — where the shell's `<main>` column sits across the viewport, for the
 * snackbar to centre over (`@commise/ui/popup-insets`; issue 508).
 *
 * The column is MEASURED, so there is no sidebar width stated here: the sidebar open or collapsed, a future side panel,
 * and the viewport's own scrollbar all show up as `<main>`'s box. Below the width the sidebar shows, `<main>` spans the
 * viewport, so the column is the whole viewport and the snackbar sits as it did.
 *
 * A route outside the shell registers no column (the page-column rule in `@commise/ui/popup-insets`).
 */
import type { PageColumn } from '@commise/ui/popup-insets';

/** The whole viewport: no column narrower than it. */
const WHOLE_VIEWPORT: PageColumn = { left: 0, right: 0 };

/**
 * The viewport px outside the shell's `<main>`, along each side.
 *
 * @param main - The laid-out `<main>`, or `null` before it mounts.
 * @param viewportWidth - The viewport's width without its scrollbar, which a `fixed` box's `right` is measured from.
 * @returns The offsets from the left and right edges to `<main>`'s box.
 * @sideEffect Reads layout (`getBoundingClientRect`).
 */
export function mainColumnOf(main: HTMLElement | null, viewportWidth: number): PageColumn {
    if (main === null) {
        return WHOLE_VIEWPORT;
    }

    const box = main.getBoundingClientRect();

    return { left: box.left, right: viewportWidth - box.right };
}
