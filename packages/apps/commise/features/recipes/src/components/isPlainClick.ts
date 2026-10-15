/**
 * @module @commise/features-recipes — whether a click on a web link should go to the app's handler instead of the
 * link's own navigation: a plain primary click only, so a modified click (new tab, new window) keeps the browser's
 * own behaviour.
 */
import type { MouseEvent } from 'react';

/**
 * @param event - The click.
 * @returns `true` for a plain primary click. Pure.
 */
export function isPlainClick(
    event: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
): boolean {
    return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
