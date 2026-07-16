import { LogBox } from 'react-native';

// Silence two KNOWN-INERT dev-only LogBox notifications (console logging is unaffected; production has no
// LogBox). Suppressing them keeps the dev screen clean AND unblocks Maestro, whose Android view-hierarchy
// driver is occluded by LogBox's overlay window (adb's uiautomator sees through it; Maestro's driver reads
// the top window). Scoped to exact signatures — any OTHER warning/error still surfaces normally.
//
//  1. The Clerk browser-UI script loader. `@clerk/expo@2.19.0` is an internally inconsistent published
//     release: its `@clerk/react@5.54.0` imports `loadClerkUiScript`, a symbol that exists only in
//     `@clerk/shared@4.x`, while its bundled `@clerk/clerk-js@5.125` pins `@clerk/shared@3.x` — so the
//     import resolves to `undefined` and calling it rejects with "undefined is not a function". The call
//     loads Clerk's HOSTED browser sign-in UI, which this app never uses (it ships a custom login screen),
//     so the rejection is functionally inert. The next `@clerk/expo` (3.x) is a clerk-js-6 major bump that
//     would risk the working custom-token sign-in flow; revisit this suppression when taking that upgrade.
//  2. Clerk's standard "loaded with development keys" notice — expected on the sandbox dev instance.
LogBox.ignoreLogs([
    /Uncaught \(in promise.*undefined is not a function/,
    /Clerk has been loaded with development keys/,
]);

// Hermes (React Native's engine) lacks `Intl.PluralRules`, which the shared recipe formatters use (browsers
// have it, so web works, but the native app crashes without this). Polyfill it FIRST, before any module
// that touches Intl loads. The @formatjs polyfills self-check and no-op when a native impl already exists.
import '@formatjs/intl-getcanonicallocales/polyfill';
import '@formatjs/intl-locale/polyfill';
import '@formatjs/intl-pluralrules/polyfill';
import '@formatjs/intl-pluralrules/locale-data/en';

import { ClerkProvider } from '@clerk/expo';
import { PlayfairDisplay_600SemiBold, PlayfairDisplay_700Bold, useFonts } from '@expo-google-fonts/playfair-display';
import { registerRootComponent } from 'expo';
import * as Sentry from '@sentry/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import type { JSX } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TamaguiProvider } from 'tamagui';
import { AuthGate } from './src/components/AuthGate';
import { LocaleProvider } from './src/i18n/LocaleProvider';
import { initSentry } from './src/observability/sentry';
import { RecipeServiceGate } from './src/providers/RecipeServiceGate';
import { AppRoot as RootNavigator } from './src/screens/AppRoot';
import { tokenCache } from './src/storage/tokenCache';
import tamaguiConfig from './tamagui.config';

const sentryInitialized = initSentry();

const queryClient = new QueryClient();

const publishableKey = process.env.EXPO_PUBLIC_IDP_PUBLISHABLE_KEY;

if (!publishableKey) {
    throw new Error('Missing EXPO_PUBLIC_IDP_PUBLISHABLE_KEY environment variable');
}

function App(): JSX.Element {
    // Load the Playfair Display faces used by the Home greeting/display headings. Non-blocking on purpose: we
    // do NOT gate the first render on it — RN falls back to the system serif until the faces register, then
    // re-renders — so a slow or failed font load can never hold the whole app on a blank screen.
    useFonts({ PlayfairDisplay_600SemiBold, PlayfairDisplay_700Bold });

    return (
        <TamaguiProvider config={tamaguiConfig} defaultTheme="light">
            <LocaleProvider>
                <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache} telemetry={false}>
                    <QueryClientProvider client={queryClient}>
                        <RecipeServiceGate>
                            <SafeAreaProvider>
                                <StatusBar style="auto" />
                                <AuthGate>
                                    <RootNavigator />
                                </AuthGate>
                            </SafeAreaProvider>
                        </RecipeServiceGate>
                    </QueryClientProvider>
                </ClerkProvider>
            </LocaleProvider>
        </TamaguiProvider>
    );
}

// Wrap provides the error boundary + touch/navigation instrumentation (R20) — but ONLY when Sentry was
// actually initialized (a DSN was present). Wrapping an un-initialized client warns "Sentry.wrap was
// called before Sentry.init", so a DSN-less local/dev build renders the app un-wrapped.
const AppRoot = sentryInitialized ? Sentry.wrap(App) : App;

// `main` in package.json points at this file, so it must register the root component itself (there is no
// `expo/AppEntry` shim doing it — that shim's `../../App` path does not resolve to this monorepo location).
registerRootComponent(AppRoot);

export default AppRoot;
