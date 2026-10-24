/**
 * @module cards/browser/phoneViewport — the phone a `phoneViewport` card pretends to be, and how it becomes the
 * window. Runs on the card page.
 */
import { phoneMatches } from './phoneMediaQuery.js';
import { PHONE_VIEWPORT } from './phoneSize.js';

/** A `MediaQueryList` that never changes: the phone does not rotate. */
function staticList(media: string, matches: boolean): MediaQueryList {
    return {
        media,
        matches,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
    };
}

/**
 * Makes the window a 390 x 844 phone: `innerWidth`, `innerHeight` and `visualViewport`, then a `resize`, and a
 * `matchMedia` that answers the viewport features from the phone. `matchMedia` reads the browser's real window, not
 * those properties, so without this a width query would still see the wide window.
 *
 * @sideEffect Redefines properties of `win`, dispatches `resize` events and replaces `win.matchMedia`.
 * @param win - The card page's window.
 */
export function installPhoneViewport(win: Window): void {
    Object.defineProperty(win, 'innerWidth', { configurable: true, value: PHONE_VIEWPORT.width });
    Object.defineProperty(win, 'innerHeight', { configurable: true, value: PHONE_VIEWPORT.height });

    if (win.visualViewport) {
        Object.defineProperty(win.visualViewport, 'width', { configurable: true, value: PHONE_VIEWPORT.width });
        Object.defineProperty(win.visualViewport, 'height', { configurable: true, value: PHONE_VIEWPORT.height });
        win.visualViewport.dispatchEvent(new Event('resize'));
    }

    win.dispatchEvent(new Event('resize'));

    const browserMatchMedia = typeof win.matchMedia === 'function' ? win.matchMedia.bind(win) : null;

    win.matchMedia = (query: string): MediaQueryList => {
        const text = String(query);
        const askBrowser = (term: string): boolean => browserMatchMedia?.(term).matches ?? false;

        return staticList(text, phoneMatches(text, askBrowser));
    };
}
