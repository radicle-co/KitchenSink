/**
 * The post-login root (mobile): the app's navigation, which starts on Home.
 *
 * // ⚠️ DELIBERATE — React Navigation 7 is the navigation library, one native stack per tab: read
 * // `docs/architecture/decisions/0056-native-navigation-react-navigation-7.md` before replacing it. The earlier
 * // `useState` destination switch (the "B13" note: "three flat destinations, no history requirements") stopped holding
 * // when the owner required per-tab history, push and pop with the iOS edge swipe, pop-to-root on a second tab tap,
 * // and Profile pushed onto any tab.
 *
 * The spine, the back-handler order, the crash boundary and the snackbar host live in `navigation/RootNavigator.tsx`.
 */
import type { JSX } from 'react';

import { RootNavigator } from '../navigation/RootNavigator.js';

/**
 * The app's post-login root.
 *
 * @returns The navigation, starting on Home.
 */
export function AppRoot(): JSX.Element {
    return <RootNavigator />;
}
