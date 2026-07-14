// Hermes (React Native's engine) lacks `Intl.PluralRules`, which the shared recipe formatters use (browsers
// have it, so web works, but the native app crashes without this). Polyfill it FIRST, before any module
// that touches Intl loads. The @formatjs polyfills self-check and no-op when a native impl already exists.
import '@formatjs/intl-getcanonicallocales/polyfill';
import '@formatjs/intl-locale/polyfill';
import '@formatjs/intl-pluralrules/polyfill';
import '@formatjs/intl-pluralrules/locale-data/en';

import { ClerkProvider } from '@clerk/expo';
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
import { RecipesScreen } from './src/screens/RecipesScreen';
import { tokenCache } from './src/storage/tokenCache';
import tamaguiConfig from './tamagui.config';

initSentry();

const queryClient = new QueryClient();

const publishableKey = process.env.EXPO_PUBLIC_IDP_PUBLISHABLE_KEY;

if (!publishableKey) {
    throw new Error('Missing EXPO_PUBLIC_IDP_PUBLISHABLE_KEY environment variable');
}

function App(): JSX.Element {
    return (
        <TamaguiProvider config={tamaguiConfig} defaultTheme="light">
            <LocaleProvider>
                <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
                    <QueryClientProvider client={queryClient}>
                        <RecipeServiceGate>
                            <SafeAreaProvider>
                                <StatusBar style="auto" />
                                <AuthGate>
                                    <RecipesScreen />
                                </AuthGate>
                            </SafeAreaProvider>
                        </RecipeServiceGate>
                    </QueryClientProvider>
                </ClerkProvider>
            </LocaleProvider>
        </TamaguiProvider>
    );
}

// Wrap provides the error boundary + touch/navigation instrumentation (R20).
const AppRoot = Sentry.wrap(App);

// `main` in package.json points at this file, so it must register the root component itself (there is no
// `expo/AppEntry` shim doing it — that shim's `../../App` path does not resolve to this monorepo location).
registerRootComponent(AppRoot);

export default AppRoot;
