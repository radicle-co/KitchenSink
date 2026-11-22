/**
 * @module @commise/features-recipes/detail — the one spoken announcement of why a private recipe stays private (KTD-6).
 */
import { useState } from 'react';

import { publicRefusalLineOf, type PublicRefusal } from '../actions/publicRefusal.js';
import type { PublicRefusalMessages } from '../actions/messages.js';

/**
 * The reason line to announce, from the render before this one (React's "store information from previous renders"
 * pattern, no ref). It is the line only in the render where the reason goes from NOTHING to a reason, after the page knew
 * who was looking: a page that opens with the reason, or whose viewer is read later, says nothing. A moment line that
 * clears and lets the reason return does not change it, so it is not said again.
 *
 * @param ready - The page knows who is looking.
 * @param shown - The owner is looking at a recipe that is not public: only then is `standing` shown.
 * @param standing - Why the recipe cannot be public, or `none`.
 * @param lines - The reason lines.
 * @returns The line to announce this render, or `undefined`.
 */
export function useStandingAnnouncement(
    ready: boolean,
    shown: boolean,
    standing: PublicRefusal,
    lines: PublicRefusalMessages,
): string | undefined {
    const shownReason = shown ? standing : 'none';
    const [seenReason, setSeenReason] = useState<PublicRefusal | undefined>(undefined);
    const [announcement, setAnnouncement] = useState<string | undefined>(undefined);

    if (ready && seenReason !== shownReason) {
        setSeenReason(shownReason);
        setAnnouncement(
            seenReason === 'none' && shownReason !== 'none' ? publicRefusalLineOf(shownReason, lines) : undefined,
        );
    }

    return announcement;
}
