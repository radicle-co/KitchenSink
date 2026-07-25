'use client';

/**
 * Client provider tree for the recipe feature: a TanStack Query `QueryClientProvider` plus the
 * `RecipeServiceProvider` that hands a configured {@link RecipeServiceClient} to every recipe hook
 * (`useRecipes`, `useRecipe`, …). Mounted once inside `[locale]/layout.tsx` (within `ClerkProvider`, so
 * `useAuth` has its context), so all recipe routes share one query cache and one authenticated client.
 *
 * The client's base origin is injected from `NEXT_PUBLIC_API_URL` (never hardcoded — CODING_STANDARDS
 * §12), defaulting to the local identity/recipe API for `npm run dev`. Its bearer token is minted per
 * request from Clerk's session (`useAuth().getToken`), read through a ref so the once-created client
 * always sees the live `getToken` without being torn down and rebuilt on Clerk re-renders; a client
 * retry of the first-token identity-sync race (`forceRefresh`) maps to Clerk's `skipCache`.
 */
import { useAuth } from '@clerk/nextjs';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { RECIPE_SERVICE_BASE_URL } from '@/lib/recipeServiceConfig';

/**
 * Provide the recipe query client + service client to the subtree.
 *
 * @param props - The subtree to wrap.
 * @returns The provider tree wrapping `children`.
 */
export function RecipeProviders({ children }: { readonly children: ReactNode }): ReactElement {
    const { getToken } = useAuth();

    // Always read the latest `getToken` (Clerk may hand back a new identity across renders) without
    // recreating the memoized client below.
    const getTokenRef = useRef(getToken);
    getTokenRef.current = getToken;

    const [queryClient] = useState(() => new QueryClient());
    const [client] = useState(
        () =>
            new RecipeServiceClient({
                baseUrl: RECIPE_SERVICE_BASE_URL,
                token: async ({ forceRefresh } = {}) => {
                    // `getToken` comes from Clerk's client `useAuth`, so it is only defined in the browser;
                    // during SSR / pre-hydration it can be undefined. Any request issued before it is ready
                    // is sent unauthenticated rather than throwing inside the request pipeline.
                    const getToken = getTokenRef.current;

                    if (typeof getToken !== 'function') {
                        return '';
                    }

                    return (await getToken({ skipCache: forceRefresh === true })) ?? '';
                },
            }),
    );

    return (
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={client}>{children}</RecipeServiceProvider>
        </QueryClientProvider>
    );
}
