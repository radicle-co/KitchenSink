/**
 * @module routeLink/isModifiedClick — whether a click on a web link asks the browser for something other than this
 * page: a new tab or window, or a download. The design system's route links (segments, the avatar, a header's back
 * link) hand a PLAIN click to the app's router and leave a modified one to the browser, which is why each stays a real
 * link with its `href`. Internal to `@commise/ui`; not a package export.
 */
import type { MouseEvent } from 'react';

/**
 * @param event - The click.
 * @returns True for a non-primary button or any modifier key. Pure.
 */
export function isModifiedClick(event: MouseEvent): boolean {
    return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}
