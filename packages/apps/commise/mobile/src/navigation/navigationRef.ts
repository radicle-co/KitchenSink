/**
 * @module navigation/navigationRef — the navigation container's handle, for the one move made from outside every
 * navigator: a crashed screen's "Go to Home". `createNavigationContainerRef` is React Navigation's documented way to
 * navigate without a navigation prop; it is not a React ref to a DOM or native node.
 */
import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './routes.js';

/** The app's navigation container handle. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Reset the app to Home: the tabs, on the Home tab's root.
 *
 * @sideEffect Replaces the navigation state.
 */
export function resetToHome(): void {
    if (navigationRef.isReady()) {
        navigationRef.reset({ index: 0, routes: [{ name: 'Tabs', params: { screen: 'home' } }] });
    }
}
