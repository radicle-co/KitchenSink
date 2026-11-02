/**
 * @module @commise/ui/overlay — the dismiss vocabulary of a window overlay, with NO React and NO React Native in it.
 *
 * A sheet or dialog in a `Modal` window can be asked to close five ways. Android Back arrives through the window's
 * `onRequestClose`, never through `BackHandler`, so the window answers it itself (`BackInterceptProvider`'s module doc
 * explains why). Every route ends in ONE host decision: the host owns `open`, and a request it ignores is a veto.
 *
 * @pattern Chain of Responsibility — `answerWindowBack` offers Back to the window's interceptors, newest first, and
 *     only then to the host's request.
 */
import type { BackInterceptRegistry } from '../backIntercept/backInterceptRegistry.js';

/**
 * The ways a window overlay is asked to close, each with a caller: `back` (the window's Back), `scrim` (a press on the scrim), `swipe` (a
 * swipe down on a sheet's handle or title row), `close` (a Close control), `escape` (the VoiceOver two-finger gesture, through `OverlayView`),
 * and `sheet`, a close the sheet engine reports without saying why (an overlay press and a drag cannot be told apart).
 * The route is diagnostic only: a host must not branch on it.
 */
export const DISMISS_ROUTES = ['back', 'scrim', 'swipe', 'close', 'escape', 'sheet'] as const;

/** One of the {@link DISMISS_ROUTES}. */
export type DismissRoute = (typeof DISMISS_ROUTES)[number];

/**
 * Ask the host to close the overlay. Fire and forget: the host answers by changing `open`, or by not changing it (a
 * veto). Must be idempotent, because two routes can fire together (Back and a scrim tap).
 */
export type DismissRequest = (route: DismissRoute) => void;

/**
 * Answer a Back press inside a window: the window's own interceptors first, then the host's request.
 *
 * @param registry - The window's scope.
 * @param request - The host's dismissal policy.
 * @sideEffect Calls the interceptors and, when none consumes the press, `request`.
 */
export function answerWindowBack(registry: BackInterceptRegistry, request: DismissRequest): void {
    if (!registry.dispatch()) {
        request('back');
    }
}
