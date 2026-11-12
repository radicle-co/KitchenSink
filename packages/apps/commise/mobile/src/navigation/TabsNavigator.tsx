/**
 * @module navigation/TabsNavigator — the bottom tabs, one native stack each (ADR-0056; blueprint A6), drawn by our own
 * bar (`AppTabBar`, D6/D14). `backBehavior="initialRoute"`: Android Back from the root of Recipes, Discover or You goes
 * to Home, and from Home leaves the app (`buildSpec.md` §3.5). You is Profile's own `profile` stack (owner ruling
 * 2026-11-11, N3).
 *
 * ORCHESTRATION: it composes the navigator; the bar it draws is presentational (`HomeTabBar`).
 *
 * @pattern Composite — four per-tab stacks under one tab navigator
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { JSX } from 'react';
import { View } from 'react-native';

import { AppTabBar } from './AppTabBar.js';
import type { TabParamList } from './routes.js';
import { TabStack } from './stacks.js';

const Tabs = createBottomTabNavigator<TabParamList>();

/** Props for {@link TabsNavigator}. */
export interface TabsNavigatorProps {
    /** Reports the laid-out tab bar's height, which the app's popups (the snackbar) keep clear of. */
    readonly onTabBarHeight: (height: number) => void;
}

/**
 * @param props - Where the tab bar's height goes.
 * @returns The tabs.
 */
export function TabsNavigator({ onTabBarHeight }: TabsNavigatorProps): JSX.Element {
    return (
        <Tabs.Navigator
            backBehavior="initialRoute"
            screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}
            tabBar={(props) => (
                <View onLayout={(event) => onTabBarHeight(event.nativeEvent.layout.height)}>
                    <AppTabBar {...props} />
                </View>
            )}
        >
            <Tabs.Screen name="home">{() => <TabStack tab="home" />}</Tabs.Screen>
            <Tabs.Screen name="recipes">{() => <TabStack tab="recipes" />}</Tabs.Screen>
            <Tabs.Screen name="discover">{() => <TabStack tab="discover" />}</Tabs.Screen>
            <Tabs.Screen name="you">{() => <TabStack tab="you" />}</Tabs.Screen>
        </Tabs.Navigator>
    );
}
