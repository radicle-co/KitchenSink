/**
 * @module artifactGlobals — the one place a shim reads a `window.__commise*` value the artifact page may set. A page
 * that wants other insets, or another current path, sets the global before the bundle renders; no shim reads a window
 * property anywhere else, so the back-channel is typed and findable.
 *
 * @pattern Facade over the page's window globals
 */
import type { EdgeInsets } from 'react-native-safe-area-context';

declare global {
    interface Window {
        /** Safe-area insets the page wants every native screen to see instead of the iPhone default. */
        __commiseInsets?: EdgeInsets;
        /** The path `usePathname` answers, e.g. `/en/recipes`. */
        __commisePath?: string;
    }
}

/** What `usePathname` answers when the page sets nothing. */
export const DEFAULT_PATH = '/en';

/**
 * The insets override the page set, if any.
 *
 * @sideEffect Reads `window`.
 * @returns The override, or undefined.
 */
export function insetsOverride(): EdgeInsets | undefined {
    return typeof window === 'undefined' ? undefined : window.__commiseInsets;
}

/**
 * The path the page says it is on.
 *
 * @sideEffect Reads `window`.
 * @returns The page's path, or {@link DEFAULT_PATH}.
 */
export function currentPath(): string {
    return (typeof window === 'undefined' ? undefined : window.__commisePath) ?? DEFAULT_PATH;
}
