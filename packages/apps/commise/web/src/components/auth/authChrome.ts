/**
 * @module components/auth/authChrome — the shared Tailwind class idiom for the web auth surface (U3).
 *
 * `/account`, `/settings`, and `/profile` share one visual shell — a centred, max-width column of card
 * sections with the design-system field idiom — so its classes live here once rather than being re-typed in
 * three route files (DRY on genuine shared knowledge: the auth surface's look, one reason to change). The
 * field/card/label classes deliberately mirror `@commise/features-recipes` `formSectionStyles` so the auth
 * forms read as the same product as the recipe forms; they are separate constants (DAMP across the workspace
 * boundary) rather than an imported shared control, because the two change for different reasons.
 */

/** The centred, max-width page column. Mobile-first padding; identical at every breakpoint (no regression). */
export const pageContainer = 'mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8';

/** The page heading — the display type of the recipe-list heading, so surfaces read as one product. */
export const pageHeading = 'font-display text-display-md font-bold text-ink';

/** A card section grouping related controls. */
export const sectionCard = 'flex flex-col gap-4 rounded-2xl bg-paper p-6 shadow-sm';

/** A section sub-heading inside a {@link sectionCard}. */
export const sectionHeading = 'font-display text-heading-md font-semibold text-ink';

/** The label+control vertical group wrapper. */
export const fieldGroup = 'flex flex-col gap-1';

/** A field's visible label. */
export const fieldLabel = 'text-body-sm font-medium text-ink-muted';

/** A text input / control surface — full-width, tokenised, seafoam focus ring (the recipe-form field). */
export const field =
    'w-full rounded-lg border border-line-divider bg-paper px-3 py-2 text-body-md text-ink outline-none focus:ring-2 focus:ring-focus-ring';

/** Inline error / alert text tone. */
export const errorText = 'text-body-sm text-danger-text';

/** A definition list rendering resolved identity facts (term + value rows). */
export const detailList = 'grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body-md';

/** A definition-list term. */
export const detailTerm = 'font-medium text-ink-muted';

/** A definition-list value. */
export const detailValue = 'text-ink';
