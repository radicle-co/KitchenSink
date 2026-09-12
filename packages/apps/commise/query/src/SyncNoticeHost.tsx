/**
 * @module @commise/query/sync-notice-host — the one mount that turns queue state into the visible notice.
 *
 * ⛔ IT LIVES HERE, BESIDE THE QUEUE, so both apps mount one component rather than each re-deriving the same
 * mapping from `useSyncQueue` + `useIsOffline` and drifting. The app supplies only its own copy.
 *
 * @pattern Orchestration — it reads two facts, maps them through a pure Specification, and hands the result
 *     to a presentational leaf; it renders no markup of its own.
 */
import { SyncNotice } from '@commise/ui/sync-notice';
import type { FC } from 'react';

import { useIsOffline } from './useIsOffline.js';
import { syncNoticeState, type SyncNoticeCopy } from './syncNoticeState.js';
import { useSyncQueue } from './syncProvider.js';

/** Props for {@link SyncNoticeHost}. */
export interface SyncNoticeHostProps {
    /** The app's localized strings. */
    readonly copy: SyncNoticeCopy & { readonly regionLabel: string };
}

/** Renders the app-wide connectivity + unsynced-work notice. */
export const SyncNoticeHost: FC<SyncNoticeHostProps> = ({ copy }) => {
    const offline = useIsOffline();
    const { pendingCount } = useSyncQueue();

    return <SyncNotice state={syncNoticeState({ offline, pendingCount }, copy)} regionLabel={copy.regionLabel} />;
};
