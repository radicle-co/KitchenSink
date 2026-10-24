/**
 * @module navigation/RootNavigator — the app's navigation spine (ADR-0056; blueprint A6; `buildSpec.md` §3.5, §3.7).
 *
 * `BackInterceptProvider` → `NavigationContainer` → the root native stack: the tabs, then the focused tasks above them.
 * A pushed or task screen pops on Android Back and on the iOS edge swipe. Every routed screen contains its own crash
 * (`ScreenBoundary`), so the tab bar survives a screen that throws.
 *
 * ⛔ THE BACK-HANDLER ORDER IS LOAD-BEARING. React Native calls `hardwareBackPress` listeners LAST-REGISTERED FIRST, and
 * React runs a child's effects before its parent's — so a provider mounted INSIDE the container subscribes before the
 * container does and would be asked AFTER it: an open sheet's Back would pop the screen under it. Mounted OUTSIDE, the
 * provider subscribes last and is asked first: a sheet or a guarded editor gets first refusal, and a press nothing
 * claims falls through (`onUnhandled` → false) to React Navigation's own handler, which pops or leaves the app. The
 * blueprint drew it the other way round; this order is the one the subscription semantics require.
 *
 * ORCHESTRATION: the navigation's composition root; every screen below it is a route component.
 *
 * @pattern Composition root — the back-intercept chain, the navigation container, the snackbar host and the root stack
 */
import { DefaultTheme, NavigationContainer, type Theme as NavigationTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BackInterceptProvider } from '@commise/ui/back-intercept';
import { PopupInsetsContext } from '@commise/ui/popup-insets';
import { SnackbarHost } from '@commise/ui/snackbar';
import { useTheme } from '@commise/ui/theme';
import { useCallback, useMemo, useState, type JSX } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { navigationRef } from './navigationRef.js';
import type { RootStackParamList } from './routes.js';
import { ScreenBoundary } from './ScreenBoundary.js';
import { ScreenFrame } from './ScreenFrame.js';
import { TabsNavigator } from './TabsNavigator.js';
import { taskScreens } from './tasks.js';

const RootStack = createNativeStackNavigator<RootStackParamList>();

/** A focused task's frame: it owns the bottom edge, since no tab bar is under it, and contains its own crash. */
function TaskLayout({ children }: { readonly children: JSX.Element }): JSX.Element {
    return (
        <ScreenFrame ownsBottom>
            <ScreenBoundary atHome={false}>{children}</ScreenBoundary>
        </ScreenFrame>
    );
}

/** The app's navigation and its one snackbar host. */
export function RootNavigator(): JSX.Element {
    const { colors, scheme } = useTheme();
    const insets = useSafeAreaInsets();
    const [tabBarHeight, setTabBarHeight] = useState(0);
    const [onTabs, setOnTabs] = useState(true);

    // The popups (the snackbar) keep clear of the tab bar while the tabs show, and of the home indicator on a task.
    const footHeight = onTabs ? tabBarHeight : insets.bottom;
    const readInsets = useCallback(() => ({ top: 0, bottom: footHeight }), [footHeight]);

    // Transparent scenes, so the root `AppCanvas` wash shows through (issue #145); the rest from the theme's roles.
    const theme = useMemo<NavigationTheme>(
        () => ({
            ...DefaultTheme,
            dark: scheme === 'dark',
            colors: {
                primary: colors.action,
                background: 'transparent',
                card: colors.paperRaised,
                text: colors.ink,
                border: colors.lineDivider,
                notification: colors.danger,
            },
        }),
        [colors, scheme],
    );

    return (
        <BackInterceptProvider onUnhandled={() => false}>
            <NavigationContainer
                ref={navigationRef}
                theme={theme}
                onStateChange={(state) => setOnTabs(state?.routes[state.index]?.name === 'Tabs')}
            >
                <PopupInsetsContext value={readInsets}>
                    <SnackbarHost>
                        <RootStack.Navigator
                            screenOptions={{
                                headerShown: false,
                                presentation: 'card',
                                gestureEnabled: true,
                                contentStyle: { backgroundColor: 'transparent' },
                            }}
                        >
                            <RootStack.Screen name="Tabs">
                                {() => <TabsNavigator onTabBarHeight={setTabBarHeight} />}
                            </RootStack.Screen>
                            <RootStack.Group screenLayout={(props) => <TaskLayout>{props.children}</TaskLayout>}>
                                {taskScreens(RootStack)}
                            </RootStack.Group>
                        </RootStack.Navigator>
                    </SnackbarHost>
                </PopupInsetsContext>
            </NavigationContainer>
        </BackInterceptProvider>
    );
}
