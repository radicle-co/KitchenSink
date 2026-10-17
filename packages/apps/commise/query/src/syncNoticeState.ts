/**
 * @module @commise/query — what the cook is told about connectivity and unsynced work.
 *
 * ⛔ THE OWNER'S BAR, AS A PURE FUNCTION: "clearly notifying a user that they are offline and what
 * data/recipe hasn't been synced with the servers". Both halves — the condition AND the count — are required,
 * so both are decided here rather than in a component where they could drift apart.
 *
 * ⛔ RECONNECTING IS ITS OWN STATE. Without it the notice would disappear the moment connectivity returned,
 * while the writes were still in flight — telling the cook everything had synced before it had.
 *
 * @pattern Specification — a pure mapping from two facts onto a rendered state, with no I/O and no clock.
 */
import type { SyncNoticeState } from '@commise/ui/sync-notice';

/** The queue facts the notice reads. */
export interface SyncFacts {
    readonly offline: boolean;
    /** Every record in the outbox, a parked one included. */
    readonly pendingCount: number;
    /** How many of those are parked: a conflict or a refusal that waits for the cook. They are not in flight. */
    readonly parkedCount: number;
    /**
     * The device was offline and its queue has not drained since ({@link recoveringOf}). "Back online" is only true
     * then: a write in flight on a connection that never dropped is not a reconnection.
     */
    readonly wasOffline: boolean;
}

/**
 * Whether the device is recovering from an offline spell: set while offline, and kept after reconnecting until the
 * writes that waited have gone. Pure.
 *
 * @param was - Whether it was recovering a moment ago.
 * @param now - Whether it is offline now, and how many writes are really going out (parked ones excluded).
 * @returns Whether it is recovering now.
 */
export function recoveringOf(was: boolean, now: { readonly offline: boolean; readonly unsynced: number }): boolean {
    return now.offline || (was && now.unsynced > 0);
}

/** The strings the notice needs, resolved by the app from its own dictionary. */
export interface SyncNoticeCopy {
    readonly offlineTitle: string;
    readonly offlineBodyNone: string;
    readonly offlineBodyOne: string;
    readonly offlineBodyOther: string;
    readonly syncingTitle: string;
    readonly syncingBodyOne: string;
    readonly syncingBodyOther: string;
    /** The unreadable-work notice's heading. */
    readonly unreadableTitle: string;
    /** Its body: no count, and plain that the work cannot be recovered. */
    readonly unreadableBody: string;
    /** Its dismiss control's visible label. */
    readonly unreadableDismiss: string;
}

/** Substitute the one placeholder these strings carry. */
function withCount(template: string, count: number): string {
    return template.replace('{count}', String(count));
}

/**
 * Decide what the notice shows.
 *
 * @param facts - Connectivity, how many writes are queued and parked, and whether the device is recovering.
 * @param copy - The app's localized strings.
 * @returns The notice state. Pure.
 */
export function syncNoticeState(facts: SyncFacts, copy: SyncNoticeCopy): SyncNoticeState {
    if (facts.offline) {
        // Every record is still on the device and unsent, a parked one included: the owner's bar is to say what has not
        // synced. Only "syncing" excludes a parked record, for that one is not going out.
        if (facts.pendingCount === 0) {
            return { kind: 'offline', title: copy.offlineTitle, body: copy.offlineBodyNone };
        }

        const body = facts.pendingCount === 1 ? copy.offlineBodyOne : copy.offlineBodyOther;

        return { kind: 'offline', title: copy.offlineTitle, body: withCount(body, facts.pendingCount) };
    }

    // A parked record is the cook's to decide on, so it is not syncing.
    const unsynced = Math.max(0, facts.pendingCount - facts.parkedCount);

    if (facts.wasOffline && unsynced > 0) {
        const body = unsynced === 1 ? copy.syncingBodyOne : copy.syncingBodyOther;

        return { kind: 'syncing', title: copy.syncingTitle, body: withCount(body, unsynced) };
    }

    return { kind: 'hidden' };
}

/**
 * Whether the unreadable-work notice shows: the session set work aside more times than the count at which the cook last
 * dismissed it. Pure.
 *
 * @param unreadableCount - How many times this session set the cook's work aside.
 * @param dismissedAt - The count when the cook dismissed (0 before any dismissal).
 * @returns Whether to show it.
 */
export function unreadableShown(unreadableCount: number, dismissedAt: number): boolean {
    return unreadableCount > dismissedAt;
}

/**
 * The dismissal count to keep for the count now: it follows the count DOWN, so a session-end reset does not leave a stale
 * dismissal hiding the next session's first set-aside. Pure.
 *
 * @param dismissedAt - The count when the cook dismissed.
 * @param unreadableCount - The count now.
 * @returns The dismissal to keep.
 */
export function dismissalFor(dismissedAt: number, unreadableCount: number): number {
    return Math.min(dismissedAt, unreadableCount);
}
