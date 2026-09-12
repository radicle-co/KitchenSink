/**
 * Provides a configured {@link RecipeServiceClient} to the recipe-service query hooks. Constructs the
 * client from the mobile API origin (`EXPO_PUBLIC_RECIPE_API_URL`) and a Clerk-backed token source, then mounts
 * `RecipeServiceProvider`. Mount inside both `ClerkProvider` (for `useAuth`) and `QueryClientProvider`
 * (the hooks own no query client of their own).
 *
 * Token attach: the client re-reads the Clerk session token per request, and passes `forceRefresh` through
 * to `getToken({ skipCache })` on any 401 retry it drives internally — the first-token identity-sync-pending
 * backoff, AND (B22) a bounded single retry after an ordinary expired-token 401 — so a token that expired
 * while backgrounded gets one chance to self-heal before the request fails.
 *
 * ⚠️ The name promises a conditional render and there is none — it renders `children` unconditionally, so
 * "does it choose a subtree?" answers no and a reader can land on the render half. It is ORCHESTRATION: it
 * reads the Clerk session and binds it to the recipe client every hook in the subtree calls through, which
 * is the authorization seam for every recipe request the app makes.
 *
 * @pattern Adapter over the Clerk session — turns `getToken` into the per-request bearer (and the
 *     `forceRefresh` → `skipCache` retry) the recipe client's token seam asks for, and nothing else.
 */
import { useAuth } from '@clerk/expo';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import type { JSX, ReactNode } from 'react';
import { useMemo } from 'react';

import { NATIVE_JWT_TEMPLATE } from '../auth/nativeToken.js';
import { env } from '../config/env.js';

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
                // Required and validated at load — `localhost` on a phone is the PHONE, so a default here
                // could never have been right in a deployed build. See `../config/env.ts`.
                baseUrl: env.EXPO_PUBLIC_RECIPE_API_URL,
                token: (options) =>
                    getToken({ template: NATIVE_JWT_TEMPLATE, skipCache: options?.forceRefresh ?? false }).then(
                        (token) => token ?? '',
                    ),
            }),
        [getToken],
    );

    return <RecipeServiceProvider client={client}>{children}</RecipeServiceProvider>;
}
