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
import { createAppQueryClient } from '@commise/query';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { QueryClientProvider } from '@tanstack/react-query';

import { offlineNoticeMessages } from '@commise/features-core/offline';
import { useMessages } from '@commise/i18n/react';
import { OfflineReadNoticeProvider } from '@commise/query/offline';
import { SyncNoticeHost } from '@commise/query/sync-notice-host';
import { recipeSender } from '@commise/query/recipe-sender';
import { SyncProvider } from '@commise/query/sync';
import { OfflineReadSlot } from '@commise/ui/offline-notice';
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
    const offline = useMessages(offlineNoticeMessages);
    // ⛔ THE SENDER MUST NEVER OUTLIVE THE CLIENT IT SENDS WITH. `client` below is rebuilt whenever Clerk's
    // `getToken` changes identity, so a sender that captured the first one would send a queued write with a
    // PREVIOUS user's token — a cross-account write. Keying the sender on `client` makes that structural:
    // the identity changes, the sender changes, and `SyncProvider`'s `flush` rebuilds on it.
    //
    // ⚠️ NO REF. A first version held the client in a `useRef` and read `.current` inside the accessor, which
    // `react-hooks/refs` correctly refused — and it was solving a problem this declarative form does not
    // have.
    const { getToken, userId } = useAuth();

    // ⛔ `createAppQueryClient`, never a bare `new QueryClient()`. A bare client takes TanStack's default
    // `retry: 3` with exponential backoff and applies it to EVERY failure, including a `404` — so a cook
    // following a dead or deleted recipe link waited ~7s on backoff while the API absorbed four requests to
    // say "no". The factory carries the shared policy: a 4xx cannot succeed on repeat and is not retried,
    // while 5xx and transport failures still are. It lives in `@commise/query` because mobile's
    // `AppProviders` mounts the same decision, and two copies would agree only by inspection.
    const [queryClient] = useState(createAppQueryClient);
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

    const send = useMemo(() => recipeSender(() => client), [client]);

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
                    <RecipeServiceProvider client={client}>{children}</RecipeServiceProvider>
                </SyncProvider>
            </OfflineReadNoticeProvider>
        </QueryClientProvider>
    );
}
