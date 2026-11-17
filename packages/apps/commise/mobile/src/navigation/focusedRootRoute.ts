/**
 * @module navigation/focusedRootRoute — how the app gate learns which root route is focused, so the offline notice can
 * take its cooking form while the cooking task is up.
 *
 * `AuthGate` sits above the navigator, so it cannot read the route. The navigator reports the focused root route
 * through an event handler (`onReady`, `onStateChange`) into this context, and the gate derives the notice's form
 * from the name during render. There is no effect and no ref, and no screen registers itself.
 *
 * @pattern Observer — the navigator reports each change of the focused root route; the gate subscribes by providing
 *     the callback
 */
import type { NavigationState, PartialState } from '@react-navigation/native';
import { createContext } from 'react';

import type { RootStackParamList } from './routes.js';

/** The root route of cooking mode, the only one that takes the notice's cooking form. */
const COOKING_ROUTE: keyof RootStackParamList = 'CookingMode';

/** What the navigator calls with the focused root route's name, or `undefined` while none is known. */
export type ReportFocusedRootRoute = (routeName: string | undefined) => void;

/** The gate's callback. Without a gate (a test of the navigator alone) a report goes nowhere. */
export const ReportFocusedRootRouteContext = createContext<ReportFocusedRootRoute>(() => undefined);

/**
 * The name of the focused root route in a navigation state. Pure.
 *
 * @param state - The container's state, or `undefined` before it is ready.
 */
export function focusedRootRouteOf(
    state: NavigationState | PartialState<NavigationState> | undefined,
): string | undefined {
    return state?.routes[state.index ?? 0]?.name;
}

/**
 * The form the app-wide notice takes for the focused root route: cooking while the cooking task is focused, the app
 * form everywhere else and before any route is known. Pure.
 *
 * @param routeName - The focused root route's name.
 */
export function noticeFormOf(routeName: string | undefined): 'app' | 'cooking' {
    return routeName === COOKING_ROUTE ? 'cooking' : 'app';
}
