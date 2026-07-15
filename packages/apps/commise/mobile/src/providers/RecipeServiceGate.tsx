/**
 * Provides a configured {@link RecipeServiceClient} to the recipe-service query hooks. Constructs the
 * client from the mobile API origin (`EXPO_PUBLIC_API_URL`) and a Clerk-backed token source, then mounts
 * `RecipeServiceProvider`. Mount inside both `ClerkProvider` (for `useAuth`) and `QueryClientProvider`
 * (the hooks own no query client of their own).
 *
 * Token attach mirrors `useUserProfile`: the client re-reads the Clerk session token per request, and on
 * an identity-sync retry (`forceRefresh`) it skips Clerk's cache to mint a current one — the same guard the
 * profile fetch uses so a token that expired while backgrounded never 401s a request.
 */
import { useAuth } from '@clerk/expo';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import type { JSX, ReactNode } from 'react';
import { useMemo } from 'react';

import { NATIVE_JWT_TEMPLATE } from '../auth/nativeToken.js';

/** Local API origin used when `EXPO_PUBLIC_API_URL` is unset (backend on :3000; no trailing `/v1`). */
const DEFAULT_API_URL = 'http://localhost:3000';

/**
 * Mount the recipe-service client provider for the subtree.
 *
 * @param props - The subtree to provide the client to.
 * @returns The provider-wrapped children.
 */
export function RecipeServiceGate({ children }: { readonly children: ReactNode }): JSX.Element {
    const { getToken } = useAuth();

    const client = useMemo(
        () =>
            new RecipeServiceClient({
                baseUrl: process.env['EXPO_PUBLIC_API_URL'] ?? DEFAULT_API_URL,
                token: (options) =>
                    getToken({ template: NATIVE_JWT_TEMPLATE, skipCache: options?.forceRefresh ?? false }).then(
                        (token) => token ?? '',
                    ),
            }),
        [getToken],
    );

    return <RecipeServiceProvider client={client}>{children}</RecipeServiceProvider>;
}
