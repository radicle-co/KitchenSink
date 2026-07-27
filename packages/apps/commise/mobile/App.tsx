import { LogBox } from 'react-native';

// Silence ONE known-inert dev-only LogBox notification (console logging is unaffected; production has no
// LogBox). Suppressing it keeps the dev screen clean AND unblocks Maestro, whose Android view-hierarchy
// driver is occluded by LogBox's overlay window (adb's uiautomator sees through it; Maestro's driver reads
// the top window). Scoped to an exact signature — any OTHER warning/error still surfaces normally.
//
// Clerk's standard "loaded with development keys" notice — expected on the sandbox dev instance.
//
// A second entry used to sit here, suppressing `Uncaught (in promise) ... undefined is not a function`: a
// defect in the internally inconsistent `@clerk/expo@2.19.0`, whose `@clerk/react@5.54.0` imported
// `loadClerkUiScript` from `@clerk/shared@4.x` while its bundled `@clerk/clerk-js@5.125` pinned
// `@clerk/shared@3.x`, so the symbol resolved to `undefined`. The `@clerk/expo@4` upgrade removed it at the
// root: the subtree is now a single consistent `@clerk/shared@4.x` + `@clerk/clerk-js@6.x`, and the symbol
// no longer exists anywhere in the dependency. That suppression is deliberately NOT carried forward — its
// regex was broad enough to hide ANY genuine "undefined is not a function" rejection, including one caused
// by a bad SDK upgrade, which is exactly the class of failure this app most needs to see. Do not re-add a
// blanket filter; fix the rejection instead.
LogBox.ignoreLogs([/Clerk has been loaded with development keys/]);

// Hermes (React Native's engine) lacks `Intl.PluralRules`, which the shared recipe formatters use (browsers
// have it, so web works, but the native app crashes without this). Polyfill it FIRST, before any module
// that touches Intl loads. The @formatjs polyfills self-check and no-op when a native impl already exists.
import '@formatjs/intl-getcanonicallocales/polyfill';
import '@formatjs/intl-locale/polyfill';
import '@formatjs/intl-pluralrules/polyfill';
import '@formatjs/intl-pluralrules/locale-data/en';

import { PlayfairDisplay_600SemiBold, PlayfairDisplay_700Bold, useFonts } from '@expo-google-fonts/playfair-display';
import { registerRootComponent } from 'expo';
import * as Sentry from '@sentry/react-native';
import { StatusBar } from 'expo-status-bar';
import type { JSX } from 'react';
import { AuthGate } from './src/components/AuthGate';
import { initSentry } from './src/observability/sentry';
import { installFocusManager, installOnlineManager } from './src/query/connectivity';
import { AppProviders } from './src/providers/AppProviders';
import { AppRoot as RootNavigator } from './src/screens/AppRoot';

const sentryInitialized = initSentry();

// B21 — React Native has no window-focus or `navigator.onLine`, so without this TanStack's refetch-on-focus
// and refetch-on-reconnect (and the offline mutation-pause) are dead. Wire the global managers ONCE at start.
installOnlineManager();
installFocusManager();

function App(): JSX.Element {
    // Load the Playfair Display faces used by the Home greeting/display headings. Non-blocking on purpose: we
    // do NOT gate the first render on it — RN falls back to the system serif until the faces register, then
    // re-renders — so a slow or failed font load can never hold the whole app on a blank screen.
    useFonts({ PlayfairDisplay_600SemiBold, PlayfairDisplay_700Bold });

    return (
        <AppProviders>
            <StatusBar style="auto" />
            <AuthGate>
                <RootNavigator />
            </AuthGate>
        </AppProviders>
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
