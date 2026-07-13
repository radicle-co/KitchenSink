import { ClerkProvider } from '@clerk/expo';
import * as Sentry from '@sentry/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import type { JSX } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TamaguiProvider } from 'tamagui';
import { AuthGate } from './src/components/AuthGate';
import { LocaleProvider } from './src/i18n/LocaleProvider';
import { initSentry } from './src/observability/sentry';
import { ProfileScreen } from './src/screens/profile';
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
                        <SafeAreaProvider>
                            <StatusBar style="auto" />
                            <AuthGate>
                                <ProfileScreen />
                            </AuthGate>
                        </SafeAreaProvider>
                    </QueryClientProvider>
                </ClerkProvider>
            </LocaleProvider>
        </TamaguiProvider>
    );
}

// Wrap provides the error boundary + touch/navigation instrumentation (R20).
export default Sentry.wrap(App);
