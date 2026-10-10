/**
 * @module @commise/ui/sync-notice — the app-wide connectivity + unsynced-work notice.
 *
 * ⛔ IT REPORTS, IT DOES NOT ASK. A queued write is safe and will send itself, so this surface carries no
 * Retry and no dismiss: there is nothing for the viewer to do, and offering an action would imply otherwise.
 *
 * ⛔ IT IS NOT AN ERROR. Offline is a pause, so the tone is status rather than alarm — the cook's work is
 * saved, it simply is not on the server yet.
 *
 * The design system carries no copy of its own; the caller passes the resolved strings.
 */

/** The states the notice can be in. Mutually exclusive, so a union rather than booleans. */
export type SyncNoticeState =
    | { readonly kind: 'hidden' }
    | { readonly kind: 'offline'; readonly title: string; readonly body: string }
    | { readonly kind: 'syncing'; readonly title: string; readonly body: string };

/** Props for the sync notice. */
export interface SyncNoticeProps {
    /** Which notice to show, if any. A union so the illegal combinations are unrepresentable. */
    readonly state: SyncNoticeState;
    /** Accessible name for the live region. */
    readonly regionLabel: string;
}
