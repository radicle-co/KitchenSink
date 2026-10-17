/**
 * @module routeLink/isModifiedClick — whether a click on a web link asks the browser for something other than this
 * page: a new tab or window, or a download. The design system's route links (segments, the avatar, a header's back
 * link, and the recipe, collection and profile links built on it) hand a PLAIN click to the app's router and leave a
 * modified one to the browser, which is why each stays a real link with its `href`. The one owner of the rule
 * (`docs/design/uiOverhaul/specSharedSystem.md` §15); the `@commise/ui/route-link` package export.
 */
import type { MouseEvent } from 'react';

/**
 * @param event - The click: only the fields the rule reads, so a test needs no synthetic event.
 * @returns True for a non-primary button or any modifier key. Pure.
 */
export function isModifiedClick(
    event: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
): boolean {
    return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}
