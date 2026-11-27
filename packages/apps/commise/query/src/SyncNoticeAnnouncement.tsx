/**
 * @module @commise/query/sync-notice-announcement — the text the open windows speak for the offline notice.
 *
 * It sits beside `SyncNoticeHost` and reads the same Specification (`cookingNoticeStateOf`), so the spoken words are the
 * notice's own words.
 *
 * Orchestration: it reads whether the app is offline and hands the title down a context; it draws nothing.
 *
 * @pattern Observer — the open windows follow the text it hands down
 */
import { WindowAnnouncementContext } from '@commise/ui/snackbar';
import type { FC, ReactNode } from 'react';

import { cookingNoticeStateOf, type SyncNoticeCopy } from './syncNoticeState.js';
import { useIsOffline } from './useIsOffline.js';

/** Props for {@link SyncNoticeAnnouncement}. */
export interface SyncNoticeAnnouncementProps {
    /** The app's localized strings: the same copy the host reads. */
    readonly copy: Pick<SyncNoticeCopy, 'offlineTitle'>;
    /** The host's form. Only `cooking` announces; the app form does not. */
    readonly form: 'app' | 'cooking';
    /** The screen whose windows speak the announcement. */
    readonly children: ReactNode;
}

/**
 * Hands the open windows the text of the offline notice, so a window can speak what the page below it cannot while the
 * window hides the page. It reads the same Specification as `SyncNoticeHost`, so the words are the notice's own.
 * Always mounted, with `form` as a prop: a wrapper that appears and disappears would remount everything under it.
 *
 * @param props - The copy, the form and the screen.
 * @returns The screen, inside the announcement channel.
 */
export const SyncNoticeAnnouncement: FC<SyncNoticeAnnouncementProps> = ({ copy, form, children }) => {
    const state = cookingNoticeStateOf(useIsOffline(), copy);
    const text = state.kind === 'offline' ? state.title : '';

    return (
        <WindowAnnouncementContext value={{ text, speaks: form === 'cooking' }}>{children}</WindowAnnouncementContext>
    );
};
