/**
 * @module @commise/ui/loading-notice — the shared contract of the design-system `LoadingNotice`: what a region says
 * while it loads and has no settled shape to hold with a skeleton (the session check, the recipe editor, collection
 * detail). Both leaves (web `LoadingNotice.tsx`, native `LoadingNotice.native.tsx`) implement this exact surface.
 */

/** Props for the `LoadingNotice` leaves (web and native). */
export interface LoadingNoticeProps {
    /**
     * Localized, CONTEXTUAL description of what is loading ("Loading recipe…"; the form is "Loading ‹thing›…"). It is
     * both the visible caption and the accessible name — never a bare "Loading" unless the caller cannot know.
     */
    readonly label: string;
}
