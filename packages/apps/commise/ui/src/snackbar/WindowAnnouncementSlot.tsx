'use client';

/**
 * @module @commise/ui/snackbar — the {@link WindowAnnouncementSlot}, one file for both platforms: the visually hidden
 * polite region in each open window that speaks the announcement the window on top is handed.
 *
 * It is a component of its own, rendered only while the outlet draws, so its derived state starts fresh each time a
 * window presents, and a hook is never called after the outlet's early return. `LiveRegion` resolves to its web or
 * native leaf at bundle time, so this file needs no native twin.
 *
 * Orchestration of one decision: it reads the window's announcement and hands it to the live region.
 *
 * @pattern Adapter over the ARIA live-region channel — the text the hook derives, spoken once per change
 */
import type { FC } from 'react';

import { LiveRegion } from '../liveRegion/LiveRegion.js';
import { useWindowAnnouncement } from './windowAnnouncement.js';

/** Props for {@link WindowAnnouncementSlot}. */
export interface WindowAnnouncementSlotProps {
    /** Whether this window's outlet is the one on top. */
    readonly isTop: boolean;
}

/**
 * One window's announcement slot.
 *
 * @param props - Whether the window is on top.
 * @returns A polite status region, empty until there is news.
 */
export const WindowAnnouncementSlot: FC<WindowAnnouncementSlotProps> = ({ isTop }) => {
    const text = useWindowAnnouncement(isTop);

    return (
        <LiveRegion politeness="polite" visuallyHidden>
            {text}
        </LiveRegion>
    );
};
