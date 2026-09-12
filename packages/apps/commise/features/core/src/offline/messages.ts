/**
 * @module @commise/features-core/offline — the offline/sync copy, shared by both platforms.
 *
 * ONE dictionary for every offline surface, consumed by the web and native leaves alike — the
 * `wizardMessages` precedent, where a single dictionary serves both leaves so the two cannot drift. It must
 * NOT be duplicated into `web/src/i18n/messages.ts` and `mobile/src/i18n/messages.ts`: the offline state says
 * the same thing on both platforms by definition, and two copies of one sentence is two things to forget.
 *
 * ⚠️ IT STARTS WITH ONE MEMBER, ON PURPOSE. The app-wide sync BANNER's copy deck is specified in
 * `docs/design/offlineNotice.md` Part I, but it is blocked on the durable write layer (its R1/R2). Pointing a
 * shippable surface at a blocked artefact is how a hard-coded literal — or a second dictionary — gets written
 * instead. So the read slot creates the dictionary and the banner joins it when it lands.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Copy for every offline surface. */
export interface OfflineNoticeMessages {
    /**
     * Shown in place of a screen's loading state when a read is parked and the device is offline.
     *
     * ⛔ THE SECOND SENTENCE IS LOAD-BEARING AND MUST NOT BE TRIMMED. A parked read resumes BY ITSELF on
     * reconnect (TanStack's `retryer.continue()`), so this surface deliberately ships no Retry control — and
     * without "This loads on its own" the viewer is left staring at a screen with no stated way forward,
     * inferring they must do something. The sentence states the guarantee rather than implying it.
     */
    readonly readOffline: string;
    /** Accessible name for the sync notice's region. */
    readonly regionLabel: string;
    /** Heading when the device has no connection. */
    readonly offlineTitle: string;
    /** Body when nothing is waiting to sync. */
    readonly offlineBodyNone: string;
    /** Body when exactly one write is waiting. `{count}` is substituted. */
    readonly offlineBodyOne: string;
    /** Body when more than one write is waiting. `{count}` is substituted. */
    readonly offlineBodyOther: string;
    /** Heading while the queue drains after reconnecting. */
    readonly syncingTitle: string;
    /** Body while one write drains. */
    readonly syncingBodyOne: string;
    /** Body while several drain. */
    readonly syncingBodyOther: string;
}

/** The offline copy, per locale. */
export const offlineNoticeMessages: LocalizedMessages<OfflineNoticeMessages> = {
    en: {
        readOffline: 'Waiting for a connection. This loads on its own.',
        regionLabel: 'Sync status',
        offlineTitle: 'You\u2019re offline',
        offlineBodyNone: 'Anything you change is saved on this device and syncs when you\u2019re back online.',
        offlineBodyOne: '{count} change is saved on this device and will sync when you\u2019re back online.',
        offlineBodyOther: '{count} changes are saved on this device and will sync when you\u2019re back online.',
        syncingTitle: 'Back online',
        syncingBodyOne: 'Syncing {count} change\u2026',
        syncingBodyOther: 'Syncing {count} changes\u2026',
    },
};
