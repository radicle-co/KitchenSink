'use client';

/**
 * The cook route's offline notice: the one `SyncNoticeHost` in its cooking form (title only while offline, quiet on
 * reconnect), handed to the cooking surface's notice slot, which draws it first inside the surface, above the top bar.
 * The route and the segment's loading frame both wrap their screen in it, so a cook offline sees one notice on every
 * cooking screen.
 *
 * Orchestration: it reads the app's offline copy and mounts the host, and draws no markup of its own.
 *
 * @pattern Adapter — the app's host and copy, to the cooking package's notice slot
 */
import { offlineNoticeMessages } from '@commise/features-core/offline';
import { CookingNoticeSlot } from '@commise/features-cooking/web';
import { useMessages } from '@commise/i18n/react';
import { SyncNoticeHost } from '@commise/query/sync-notice-host';
import type { FC, ReactNode } from 'react';

/** Props for {@link CookingNoticeMount}. */
interface CookingNoticeMountProps {
    /** The cooking screen the notice belongs to. */
    readonly children: ReactNode;
}

/** Supplies the cooking-form offline notice to every cooking frame below. */
export const CookingNoticeMount: FC<CookingNoticeMountProps> = ({ children }) => {
    const copy = useMessages(offlineNoticeMessages);

    return <CookingNoticeSlot notice={<SyncNoticeHost copy={copy} form="cooking" />}>{children}</CookingNoticeSlot>;
};
