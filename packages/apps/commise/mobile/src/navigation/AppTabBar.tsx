/**
 * @module navigation/AppTabBar — React Navigation's tab state, drawn by our own {@link HomeTabBar} (ownerDecisions D6,
 * D14; `docs/architecture/uiOverhaulBlueprint.md` A6).
 *
 * It does exactly what the library's default bar does with a press, and nothing more: it emits `tabPress` with
 * `canPreventDefault` and navigates unless a listener prevented it. The library's own listeners then give the second
 * tap on the active tab its meaning — the tab's stack pops to its root, and at the root `useScrollToTop` scrolls the
 * screen (`TabRootScreen`). Re-implementing either here would fork the library's behaviour.
 *
 * ORCHESTRATION: it drives the navigator (emit, navigate); the bar it draws is presentational.
 *
 * @pattern Adapter from `BottomTabBarProps` to the presentational `HomeTabBar`
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import type { HomeNavItemId } from '@commise/features-core';
import { useMessages } from '@commise/i18n/react';
import type { JSX } from 'react';

import { HomeTabBar } from '../components/home/chrome/HomeTabBar.js';
import { LIVE_CAPABILITIES } from '../components/home/liveCapabilities.js';
import { mobileMessages } from '../i18n/messages.js';
import { isTabRoute } from './routes.js';

/**
 * @param props - The tab navigator's state, descriptors, navigation and safe-area insets.
 * @returns The app's tab bar.
 */
export function AppTabBar({ state, navigation, insets }: BottomTabBarProps): JSX.Element {
    const { home } = useMessages(mobileMessages);
    const active = state.routes[state.index];
    const activeName = active?.name;

    const routeOf = (id: HomeNavItemId) => state.routes.find((route) => route.name === id);

    return (
        <HomeTabBar
            chrome={home.chrome}
            liveCapabilities={LIVE_CAPABILITIES}
            activeId={activeName !== undefined && isTabRoute(activeName) ? activeName : 'home'}
            bottomInset={insets.bottom}
            onPress={(id) => {
                const route = routeOf(id);

                if (route === undefined) {
                    return;
                }

                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });

                if (route.key !== active?.key && !event.defaultPrevented) {
                    navigation.navigate(route.name, route.params);
                }
            }}
            onLongPress={(id) => {
                const route = routeOf(id);

                if (route !== undefined) {
                    navigation.emit({ type: 'tabLongPress', target: route.key });
                }
            }}
        />
    );
}
