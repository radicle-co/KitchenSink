/**
 * `AppProviders` (DA10-a) — the mobile app's provider-tree Facade, the native counterpart of the web
 * `RecipeProviders` (`web/src/components/recipes/RecipeProviders.tsx`). Centralizes the ENFORCED provider
 * order that used to be hand-stacked directly in `App.tsx`: `RecipeServiceGate` calls `useAuth` (Clerk) AND
 * reads no query client of its own (its hooks run against whichever `QueryClientProvider` is mounted above
 * them), so it MUST sit below both `ClerkProvider` and `QueryClientProvider` — the same invariant the web
 * facade documents.
 *
 * Composes, top to bottom: `TamaguiProvider` (design tokens/theme) → `LocaleProvider` (device-locale i18n)
 * → `ClerkProvider` (auth session, secure-store-backed token cache) → `QueryClientProvider` (TanStack cache)
 * → `RecipeServiceGate` (the typed recipe-service client) → `SafeAreaProvider` (device insets) → `children`.
 *
 * This is a pure extraction (Facade pattern) — the tree and its order are UNCHANGED from what `App.tsx`
 * hand-stacked before; only the composition now lives in one reusable, testable place. `App.tsx` keeps
 * ownership of everything that is NOT a provider (font loading, the status bar, `AuthGate`, the navigator).
 *
 * ⚠️ Read as SHAPE this is props → JSX with one `useState`, which is the profile of a render leaf exactly.
 * It is ORCHESTRATION all the same, for the same reason the web facade is: the identity of what it mounts —
 * the query cache, the Clerk session and its secure-store token cache, the recipe client — is the app's data
 * and auth capability, and the ENFORCED order between them is a decision this component owns alone.
 *
 * @pattern Facade over the app's six-deep provider stack — one composition root, so a caller mounts one
 *     component instead of remembering an order whose violation only shows up at runtime.
 */
import { ClerkProvider } from '@clerk/expo';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { JSX, ReactNode } from 'react';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TamaguiProvider } from 'tamagui';

import { LocaleProvider } from '../i18n/LocaleProvider.js';
import { tokenCache } from '../storage/tokenCache.js';
import tamaguiConfig from '../../tamagui.config.js';
import { RecipeServiceGate } from './RecipeServiceGate.js';

const publishableKey = process.env['EXPO_PUBLIC_IDP_PUBLISHABLE_KEY'];

if (!publishableKey) {
    throw new Error('Missing EXPO_PUBLIC_IDP_PUBLISHABLE_KEY environment variable');
}

/**
 * Mount the full app-level provider tree around `children`.
 *
 * @param props - The subtree to wrap (the app's screens/navigator).
 * @returns The provider tree wrapping `children`, in the enforced order documented above.
 */
export function AppProviders({ children }: { readonly children: ReactNode }): JSX.Element {
    const [queryClient] = useState(() => new QueryClient());

    return (
        <TamaguiProvider config={tamaguiConfig} defaultTheme="light">
            <LocaleProvider>
                <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache} telemetry={false}>
                    <QueryClientProvider client={queryClient}>
                        <RecipeServiceGate>
                            <SafeAreaProvider>{children}</SafeAreaProvider>
                        </RecipeServiceGate>
                    </QueryClientProvider>
                </ClerkProvider>
            </LocaleProvider>
        </TamaguiProvider>
    );
}
