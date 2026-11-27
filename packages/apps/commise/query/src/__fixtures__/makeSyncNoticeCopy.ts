/**
 * @module the app's sync notice strings as a test fixture, so a change to the copy contract is made in one place.
 */
import type { SyncNoticeCopy } from '../syncNoticeState.js';

/** The strings the host reads, with the region label the host adds. */
export type SyncNoticeHostCopy = SyncNoticeCopy & { readonly regionLabel: string };

/**
 * The English strings, with any of them replaced.
 *
 * @param overrides - Strings to replace.
 * @returns A complete copy.
 */
export function makeSyncNoticeCopy(overrides: Partial<SyncNoticeHostCopy> = {}): SyncNoticeHostCopy {
    return {
        regionLabel: 'Sync status',
        offlineTitle: 'You’re offline',
        offlineBodyNone: 'Saved here.',
        offlineBodyOne: '{count} change is saved here.',
        offlineBodyOther: '{count} changes are saved here.',
        syncingTitle: 'Back online',
        syncingBodyOne: 'Syncing {count} change…',
        syncingBodyOther: 'Syncing {count} changes…',
        unreadableTitle: 'Some work on this device couldn’t be opened',
        unreadableBody: 'We can’t show it or send it, and it can’t be recovered.',
        unreadableDismiss: 'Dismiss',
        ...overrides,
    };
}
