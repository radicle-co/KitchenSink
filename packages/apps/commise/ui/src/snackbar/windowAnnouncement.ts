/**
 * @module @commise/ui/snackbar — the announcement the open windows speak for the page below them.
 *
 * A modal window hides the page from a screen reader, so a notice on that page (the offline notice while cooking)
 * cannot be heard while a window is open. The notice's mount puts its text in {@link WindowAnnouncementContext}, and
 * the window on top speaks it through its own slot, only when it CHANGES while that window is on top.
 *
 * @pattern Observer — the slot follows the text it is handed; the speaking decision is derived state, with no effect
 *     and no ref
 */
import { createContext, useContext, useState } from 'react';

/** What the page below the windows has to say, and whether it is the kind of notice a window speaks. */
export interface WindowAnnouncement {
    /** The notice text, or `''` when there is none. It is handed down even when the window must not speak it. */
    readonly text: string;
    /** Whether the open windows speak `text`. A notice form that a window does not speak still hands its text down. */
    readonly speaks: boolean;
}

/**
 * The announcement the windows are handed. The text is handed down whether or not the windows speak it, so a change of
 * notice form never looks like news: a title that was already there stays silent when the form starts to speak.
 */
export const WindowAnnouncementContext = createContext<WindowAnnouncement>({ text: '', speaks: false });

/** What the slot has seen: whether its window was on top, and the text it was already holding then. */
interface SeenState {
    readonly wasTop: boolean;
    /** The text that stood when the window became top, which is not news. `undefined` once it has changed. */
    readonly silenced: string | undefined;
}

/**
 * The text this window's slot holds now. The slot speaks when its text changes, so the text it holds is `''` for
 * anything that is not news: a window that opens over a standing announcement, a window that is not on top, and the
 * time after the announcement went away.
 *
 * @param isTop - Whether this window's outlet is the one the snackbar draws in, which is the window on top.
 * @returns The text for the slot.
 */
export function useWindowAnnouncement(isTop: boolean): string {
    const { text: announcement, speaks } = useContext(WindowAnnouncementContext);
    const [seen, setSeen] = useState<SeenState>({ wasTop: isTop, silenced: isTop ? announcement : undefined });

    // Derived during render from the previous answer (React's state-from-previous-renders pattern).
    if (!isTop) {
        if (seen.wasTop) {
            setSeen({ wasTop: false, silenced: undefined });
        }

        return '';
    }

    // A form that does not speak still sees the text, so what stands when the form starts to speak is not news.
    if (!speaks) {
        if (!seen.wasTop || seen.silenced !== announcement) {
            setSeen({ wasTop: true, silenced: announcement });
        }

        return '';
    }

    if (!seen.wasTop) {
        setSeen({ wasTop: true, silenced: announcement });

        return '';
    }

    if (seen.silenced !== undefined && announcement !== seen.silenced) {
        setSeen({ wasTop: true, silenced: undefined });
    }

    return announcement === seen.silenced ? '' : announcement;
}
