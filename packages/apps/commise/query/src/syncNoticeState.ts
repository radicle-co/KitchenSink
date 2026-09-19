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
    readonly pendingCount: number;
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
}

/** Substitute the one placeholder these strings carry. */
function withCount(template: string, count: number): string {
    return template.replace('{count}', String(count));
}

/**
 * Decide what the notice shows.
 *
 * @param facts - Connectivity and how many writes are queued.
 * @param copy - The app's localized strings.
 * @returns The notice state. Pure.
 */
export function syncNoticeState(facts: SyncFacts, copy: SyncNoticeCopy): SyncNoticeState {
    if (facts.offline) {
        if (facts.pendingCount === 0) {
            return { kind: 'offline', title: copy.offlineTitle, body: copy.offlineBodyNone };
        }

        const body = facts.pendingCount === 1 ? copy.offlineBodyOne : copy.offlineBodyOther;

        return { kind: 'offline', title: copy.offlineTitle, body: withCount(body, facts.pendingCount) };
    }

    if (facts.pendingCount > 0) {
        const body = facts.pendingCount === 1 ? copy.syncingBodyOne : copy.syncingBodyOther;

        return { kind: 'syncing', title: copy.syncingTitle, body: withCount(body, facts.pendingCount) };
    }

    return { kind: 'hidden' };
}
