/**
 * @module navigation/AppTabBar — React Navigation's tab state, drawn by our own {@link HomeTabBar} (ownerDecisions D6,
 * D14; `docs/architecture/uiOverhaulBlueprint.md` A6).
 *
 * It does exactly what the library's default bar does with a press, and nothing more: it emits `tabPress` with
 * `canPreventDefault` and navigates unless a listener prevented it. The library's own listeners then give the second
 * tap on the active tab its meaning — the tab's stack pops to its root, and at the root `useScrollToTop` scrolls the
 * screen (`TabRootScreen`). Re-implementing either here would fork the library's behaviour.
 *
 * Compact height (owner 2026-10-13): in a window under 480 dp tall it draws the compact bar, and while a keyboard is open
 * there it draws none (`isFrameCollapsed`), so a phone held sideways keeps room for the field the cook is typing in.
 *
 * ORCHESTRATION: it drives the navigator (emit, navigate); the bar it draws is presentational.
 *
 * @pattern Adapter from `BottomTabBarProps` to the presentational `HomeTabBar`
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import type { HomeNavItemId } from '@commise/features-core';
import { LIVE_CAPABILITIES } from '@commise/features-recipes/widget';
import { homeMessages } from '@commise/features-core/home';
import { useMessages } from '@commise/i18n/react';
import { useCompactHeight, useFrameCollapsed } from '@commise/ui/layout';
import type { JSX } from 'react';

import { HomeTabBar } from '../components/home/chrome/HomeTabBar.js';
import { isTabRoute } from './routes.js';

/**
 * @param props - The tab navigator's state, descriptors, navigation and safe-area insets.
 * @returns The app's tab bar.
 */
export function AppTabBar({ state, navigation, insets }: BottomTabBarProps): JSX.Element | null {
    const home = useMessages(homeMessages);
    const compact = useCompactHeight();
    const collapsed = useFrameCollapsed();
    const active = state.routes[state.index];
    const activeName = active?.name;

    const routeOf = (id: HomeNavItemId) => state.routes.find((route) => route.name === id);

    if (collapsed) {
        return null;
    }

    return (
        <HomeTabBar
            chrome={home.chrome}
            liveCapabilities={LIVE_CAPABILITIES}
            activeId={activeName !== undefined && isTabRoute(activeName) ? activeName : 'home'}
            bottomInset={insets.bottom}
            compact={compact}
            leftInset={insets.left}
            rightInset={insets.right}
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
