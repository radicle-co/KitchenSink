'use client';

/**
 * Client provider tree for the recipe feature: a TanStack Query `QueryClientProvider` plus the
 * `RecipeServiceProvider` that hands a configured {@link RecipeServiceClient} to every recipe hook
 * (`useRecipes`, `useRecipe`, …). Mounted once inside `[locale]/layout.tsx` (within `ClerkProvider`, so
 * `useAuth` has its context), so all recipe routes share one query cache and one authenticated client.
 *
 * The client's base origin is injected from `NEXT_PUBLIC_API_URL` (never hardcoded — CODING_STANDARDS
 * §12), defaulting to the local identity/recipe API for `npm run dev`. Its bearer token is minted per
 * request from Clerk's session (`useAuth().getToken`, which waits for clerk-js to load). A client retry of the
 * first-token identity-sync race (`forceRefresh`) maps to Clerk's `skipCache`.
 *
 * ⚠️ DELIBERATE — ADR-0054. Both clients are built per COOK: the memo is keyed on `userId`, and each client's token goes
 * through `subjectBoundToken`, which mints only for the cook the client was built for. Clerk's `getToken` keeps one
 * identity for the provider's life (a `useCallback` on the `IsomorphicClerk` instance `ClerkProvider` holds in a ref),
 * so keying on it alone kept one client across a change of cook, and that client read the new cook's token at send time.
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
import { useAuth, useClerk } from '@clerk/nextjs';
import { subjectBoundToken } from '@commise/features-account';
import { createAppQueryClient } from '@commise/query';
import { FoodServiceClient } from '@kitchensink/food-service-client';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { QueryClientProvider } from '@tanstack/react-query';

import { offlineNoticeMessages } from '@commise/features-core/offline';
import { useMessages } from '@commise/i18n/react';
import { OfflineReadNoticeProvider } from '@commise/query/offline';
import { SyncNoticeHost } from '@commise/query/sync-notice-host';
import { recipeSender } from '@commise/query/recipe-sender';
import { useQuerySessionScope } from '@commise/query/session-scope';
import { SyncProvider } from '@commise/query/sync';
import { OfflineReadSlot } from '@commise/ui/offline-notice';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { FOOD_SERVICE_BASE_URL } from '@/lib/foodServiceConfig';
import { RecipeAuthNotReadyError } from '@/lib/recipeAuthNotReady';
import { RECIPE_SERVICE_BASE_URL } from '@/lib/recipeServiceConfig';

/**
 * Provide the recipe query client + service client to the subtree.
 *
 * @param props - The subtree to wrap.
 * @returns The provider tree wrapping `children`.
 */
export function RecipeProviders({ children }: { readonly children: ReactNode }): ReactElement {
    const offline = useMessages(offlineNoticeMessages);
    const { getToken, userId } = useAuth();
    // The one `IsomorphicClerk` for the provider's life: the token proxy reads its LIVE session on every mint.
    const clerk = useClerk();

    // ⛔ `createAppQueryClient`, never a bare `new QueryClient()`. A bare client takes TanStack's default
    // `retry: 3` with exponential backoff and applies it to EVERY failure, including a `404` — so a cook
    // following a dead or deleted recipe link waited ~7s on backoff while the API absorbed four requests to
    // say "no". The factory carries the shared policy: a 4xx cannot succeed on repeat and is not retried,
    // while 5xx and transport failures still are. It lives in `@commise/query` because mobile's
    // `AppProviders` mounts the same decision, and two copies would agree only by inspection.
    const [queryClient] = useState(createAppQueryClient);
    // ⚠️ DELIBERATE — ADR-0054. The cache ends with the cook's session. A sign-out here also reloads the document, which
    // would hide a missing boundary, but a cook change without a reload (Clerk multi-session) would not.
    useQuerySessionScope(queryClient, userId ?? undefined);
    // The one Clerk session-token resolver both clients use, so recipe and food authenticate the same way.
    const sessionToken = useCallback(
        async (forceRefresh: boolean): Promise<string> => {
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

            const token = await getToken({ skipCache: forceRefresh });

            if (token === null || token === '') {
                throw new RecipeAuthNotReadyError('Clerk returned no session token');
            }

            return token;
        },
        [getToken],
    );
    // ⚠️ DELIBERATE — ADR-0054. Both clients per cook, and one bound mint between them. Plan 002 S5: foods and their
    // variants are read from food-service directly, at its own origin.
    const clients = useMemo(() => {
        const token = subjectBoundToken(userId ?? undefined, clerk, sessionToken);

        return {
            recipe: new RecipeServiceClient({
                baseUrl: RECIPE_SERVICE_BASE_URL,
                token: async ({ forceRefresh } = {}) => token(forceRefresh === true),
            }),
            food: new FoodServiceClient({
                baseUrl: FOOD_SERVICE_BASE_URL,
                token: async ({ forceRefresh } = {}) => token(forceRefresh === true),
            }),
        };
    }, [clerk, userId, sessionToken]);

    // The sender reads the client per call, so a new cook's sender sends with the new cook's client. A drain already
    // running holds the previous sender, whose client refuses to mint for the new cook (ADR-0054).
    const send = useMemo(() => recipeSender(() => clients.recipe), [clients]);

    return (
        <QueryClientProvider client={queryClient}>
            {/* ⛔ MOUNTED IMMEDIATELY INSIDE THE QUERY CLIENT PROVIDER, structurally rather than
                conveniently. `OfflineReadNoticeProvider`'s default is the identity function, so a
                `QueryBoundary` that escaped this provider degrades SILENTLY back to a skeleton and could
                never report itself. Co-mounting makes "has a query client" imply "has offline copy", and a
                boundary outside the client provider already fails loudly for the missing client. */}
            <OfflineReadNoticeProvider renderOffline={() => <OfflineReadSlot message={offline.readOffline} />}>
                {/* ⛔ THE QUEUE WRAPS THE SERVICE PROVIDER, not the other way round: a queued write outlives
                    the screen that made it, so its owner must sit above every feature. `subject` namespaces
                    the queue per user — a queue keyed by nothing is a cross-account read the first time a
                    second person signs in on one device.

                    ⛔ A REAL `userId` OR ABSENT — NEVER A PLACEHOLDER. This read
                    `subject={userId ?? 'anonymous'}`, which is the very thing the paragraph above forbids:
                    one shared queue for every signed-out visitor. Web's store is volatile, so nothing
                    survived a reload to leak — but "it happens to be inert here" is not a reason to write
                    the unsafe form. That invariant is what survived; the GATE it was first written as did
                    not, for the reason below.

                    ⛔ MOUNTED UNCONDITIONALLY, AND THE ABSENT-USER CASE LIVES IN `SyncProvider`. Gating this
                    with `{userId ? <SyncProvider…> : <>…</>}` changes the ELEMENT TYPE at this position, so
                    React unmounted and REMOUNTED the whole subtree the moment Clerk resolved a user —
                    wiping the recipe editor mid-flow. Six Playwright shards that passed on the previous
                    commit failed on it. A conditional here cannot be made safe; there must not be one.

                    ⛔ AND `SyncNoticeHost` STAYS INSIDE the provider. `syncNoticeState.ts` has a branch that
                    exists ONLY for offline-with-zero-pending (`offlineBodyNone`), because the owner's bar is
                    BOTH halves — tell the cook they are offline AND what has not synced — and public recipe
                    pages are readable signed out, so a signed-out visitor must still get the first half.
                    Hoisting it ABOVE the provider would hand everyone the NOT_MOUNTED default's
                    `pendingCount: 0` and silently kill the syncing body for signed-in cooks. */}
                <SyncProvider subject={userId ?? undefined} send={send}>
                    <SyncNoticeHost copy={offline} />
                    <RecipeServiceProvider client={clients.recipe}>
                        <FoodServiceProvider client={clients.food} subject={userId ?? undefined}>
                            {children}
                        </FoodServiceProvider>
                    </RecipeServiceProvider>
                </SyncProvider>
            </OfflineReadNoticeProvider>
        </QueryClientProvider>
    );
}
