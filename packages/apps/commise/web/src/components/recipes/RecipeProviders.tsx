'use client';

/**
 * Client provider tree for the recipe feature: a TanStack Query `QueryClientProvider` plus the
 * `RecipeServiceProvider` that hands a configured {@link RecipeServiceClient} to every recipe hook
 * (`useRecipes`, `useRecipe`, …). Mounted once inside `[locale]/layout.tsx` (within `ClerkProvider`, so
 * `useAuth` has its context), so all recipe routes share one query cache and one authenticated client.
 *
 * The client's base origin is injected from `NEXT_PUBLIC_API_URL` (never hardcoded — CODING_STANDARDS
 * §12), defaulting to the local identity/recipe API for `npm run dev`. Its bearer token is minted per
 * request from Clerk's session (`useAuth().getToken`). B14: this used to be bridged into the
 * once-constructed client via a ref reassigned on every render pass — the render-mutated-ref smell §3
 * forbids. Clerk's `getToken` is itself a `useCallback` keyed on its
 * `IsomorphicClerk` instance (stable across ordinary re-renders, and only changes identity on a genuine
 * identity swap — sign-in/out, or hydration handing off from the SSR placeholder), so the client is
 * instead `useMemo`'d with `getToken` as its dependency: the token callback closes over `getToken`
 * directly (no ref), and the client is only reconstructed on the rare render where `getToken` itself
 * changes — which is exactly when a rebuild is actually needed. A client retry of the first-token
 * identity-sync race (`forceRefresh`) still maps to Clerk's `skipCache`.
 *
 * ⚠️ It renders only `children`, which is the canonical render-leaf tell — and it is ORCHESTRATION
 * anyway. What it renders is not the point; what it CONSTRUCTS is. Every recipe read and write in the
 * subtree runs against the query cache and the authenticated client built here, so this is where the
 * feature's data capability is decided, and a second `QueryClient` mounted alongside would silently split
 * the cache.
 *
 * @pattern Composition root (Facade) over the recipe subtree's query cache and token-minting client — a leaf
 *     asks for neither, and the enforced provider order lives in one place rather than in every caller.
 */
import { useAuth } from '@clerk/nextjs';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { RecipeAuthNotReadyError } from '@/lib/recipeAuthNotReady';
import { RECIPE_SERVICE_BASE_URL } from '@/lib/recipeServiceConfig';

/**
 * Provide the recipe query client + service client to the subtree.
 *
 * @param props - The subtree to wrap.
 * @returns The provider tree wrapping `children`.
 */
export function RecipeProviders({ children }: { readonly children: ReactNode }): ReactElement {
    const { getToken } = useAuth();

    const [queryClient] = useState(() => new QueryClient());
    const client = useMemo(
        () =>
            new RecipeServiceClient({
                baseUrl: RECIPE_SERVICE_BASE_URL,
                token: async ({ forceRefresh } = {}) => {
                    // ⚠️ DO NOT restore an empty-string fallback here. This used to `return ''` when
                    // `getToken` was undefined (SSR/pre-hydration) or resolved `null`, on the reasoning
                    // that an unauthenticated request beats throwing inside the request pipeline. It does
                    // not: an empty bearer makes every protected recipe endpoint answer
                    // `401 {"message":"Missing bearer token"}`, so the request cannot succeed. Measured in
                    // production 2026-08-07 — `/api/v1/recipes?pageSize=4` 401'd on a signed-in Home load
                    // while the same call with a real token returned 200 — and that 401 then met the
                    // redirect-to-sign-in handler, turning a transient state into an auth failure.
                    //
                    // Throwing the typed error keeps "not ready" distinguishable from "rejected", and
                    // TanStack Query's default retry recovers it a moment later once Clerk has hydrated.
                    if (typeof getToken !== 'function') {
                        throw new RecipeAuthNotReadyError('getToken is unavailable (SSR / pre-hydration)');
                    }

                    const token = await getToken({ skipCache: forceRefresh === true });

                    if (token === null || token === '') {
                        throw new RecipeAuthNotReadyError('Clerk returned no session token');
                    }

                    return token;
                },
            }),
        [getToken],
    );

    return (
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={client}>{children}</RecipeServiceProvider>
        </QueryClientProvider>
    );
}
