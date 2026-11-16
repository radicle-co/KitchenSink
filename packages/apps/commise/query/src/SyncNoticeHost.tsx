/**
 * @module @commise/query/sync-notice-host — the one mount that turns queue state into the visible notice.
 *
 * ⛔ IT LIVES HERE, BESIDE THE QUEUE, so both apps mount one component rather than each re-deriving the same
 * mapping from `useSyncQueue` + `useIsOffline` and drifting. The app supplies only its own copy.
 *
 * ⛔ TWO LEAVES, ONE RULE EACH. `SyncNotice` reports an ongoing condition and has no controls. `UnreadableWorkNotice`
 * reports a PAST event (ADR-0057: work set aside because it could not be read), so it is dismissible and sits ABOVE the
 * sync notice. The host keeps the count at which the cook dismissed as derived state, with no effect and no ref
 * (`specSharedSystem.md` §17).
 *
 * The host has two forms, chosen by its mount (plan 0010 KTD1), and the leaves stay mode-free: `cooking` shows the
 * title only while offline and nothing else.
 *
 * @pattern Orchestration — it reads the queue's facts, maps them through pure Specifications, and hands the result
 *     to presentational leaves; it renders no markup of its own.
 */
import { SyncNotice, SyncNoticeStack, UnreadableWorkNotice } from '@commise/ui/sync-notice';
import { useState, type FC } from 'react';

import { useIsOffline } from './useIsOffline.js';
import {
    cookingNoticeStateOf,
    dismissalFor,
    recoveringOf,
    syncNoticeState,
    unreadableShown,
    type SyncNoticeCopy,
} from './syncNoticeState.js';
import { useSyncQueue } from './syncProvider.js';

/** Props for {@link SyncNoticeHost}. */
export interface SyncNoticeHostProps {
    /** The app's localized strings. */
    readonly copy: SyncNoticeCopy & { readonly regionLabel: string };
    /** `app` (default): the full notice. `cooking`: title only while offline, nothing else (plan 0010 KTD2). */
    readonly form?: 'app' | 'cooking';
}

/** Renders the app-wide connectivity + unsynced-work notice. */
export const SyncNoticeHost: FC<SyncNoticeHostProps> = ({ copy, form = 'app' }) => {
    const offline = useIsOffline();
    const { pendingCount, failures, unreadableCount } = useSyncQueue();
    const parkedCount = failures.length;
    // "Back online" needs a past offline spell, which the queue's facts do not carry: kept here, derived during render
    // from the previous answer (React's derived-state pattern), so there is no effect and no ref.
    const [wasOffline, setWasOffline] = useState(false);
    const recovering = recoveringOf(wasOffline, { offline, unsynced: Math.max(0, pendingCount - parkedCount) });

    if (recovering !== wasOffline) {
        setWasOffline(recovering);
    }

    // The count at which the cook dismissed the unreadable-work notice, kept the same way and following the count down.
    const [dismissedAt, setDismissedAt] = useState(0);
    const keptDismissal = dismissalFor(dismissedAt, unreadableCount);

    if (keptDismissal !== dismissedAt) {
        setDismissedAt(keptDismissal);
    }

    // The unreadable-work card is not drawn while cooking, but its dismissal is kept for the app form.
    const cooking = form === 'cooking';
    const unreadable = !cooking && unreadableShown(unreadableCount, keptDismissal);
    const state = cooking
        ? cookingNoticeStateOf(offline, copy)
        : syncNoticeState({ offline, pendingCount, parkedCount, wasOffline: recovering }, copy);

    return (
        <SyncNoticeStack active={unreadable || state.kind !== 'hidden'}>
            <UnreadableWorkNotice
                shown={unreadable}
                title={copy.unreadableTitle}
                body={copy.unreadableBody}
                dismissLabel={copy.unreadableDismiss}
                onDismiss={() => {
                    setDismissedAt(unreadableCount);
                }}
            />
            <SyncNotice state={state} regionLabel={copy.regionLabel} />
        </SyncNoticeStack>
    );
};
