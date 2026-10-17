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
 *
 * That rule is `SyncNotice`'s alone. A past event that must be dismissible is a different leaf, `UnreadableWorkNotice`.
 */
import type { ReactNode } from 'react';

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

/**
 * Props for the unreadable-work notice (`docs/design/uiOverhaul/specSharedSystem.md` §17).
 *
 * ⛔ A SECOND LEAF, NOT A `SyncNoticeState` MEMBER. The sync notice reports an ongoing condition and carries no
 * control; this reports a PAST event, which must be dismissible or it stays forever. The caller owns the dismissal and
 * passes `shown`; the leaf owns only where web focus lands when its card leaves.
 */
export interface UnreadableWorkNoticeProps {
    /** Whether the card shows. The region around it is mounted either way, so the change is announced. */
    readonly shown: boolean;
    /** The heading. */
    readonly title: string;
    /** The body. */
    readonly body: string;
    /** The dismiss control's visible label, which is also its accessible name. */
    readonly dismissLabel: string;
    /** Called when the cook dismisses the card. */
    readonly onDismiss: () => void;
}

/** Props for the notice stack: the column the sync and unreadable-work notices sit in. */
export interface SyncNoticeStackProps {
    /** Whether any notice is showing. Native takes the top safe-area inset only while it is. */
    readonly active: boolean;
    /** The notices, top to bottom. */
    readonly children: ReactNode;
}
