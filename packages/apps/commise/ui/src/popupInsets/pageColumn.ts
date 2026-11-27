/**
 * @module @commise/ui/popup-insets — where a page's content column sits across the viewport, for the snackbar host to
 * centre over (issue 508).
 *
 * It is a different fact from the insets: `PopupInsets` is the DOWN channel every popup reads for the chrome that
 * covers the viewport's top and foot, while the column is "where the content is", which only the snackbar host places
 * itself by.
 * So it is its own optional facet of a registered entry, never fields of `PopupInsets`.
 *
 * The rule for a route: the app shell states its column, and a route that draws outside the shell (a full-screen route
 * with no sidebar) states none, so the snackbar centres on the viewport there. Do not register one for such a route.
 */

/** The CSS px of the viewport outside the content column on each side: a fixed box's `left` and `right`. */
export interface PageColumn {
    readonly left: number;
    readonly right: number;
}

/** Reads the column now. Called when the host re-places, never during render. */
export type PageColumnReader = () => PageColumn;
