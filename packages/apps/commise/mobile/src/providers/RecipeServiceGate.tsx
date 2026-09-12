/**
 * Provides a configured {@link RecipeServiceClient} to the recipe-service query hooks. Constructs the
 * client from the mobile API origin (`EXPO_PUBLIC_RECIPE_API_URL`) and a Clerk-backed token source, then mounts
 * `RecipeServiceProvider`. Mount inside both `ClerkProvider` (for `useAuth`) and `QueryClientProvider`
 * (the hooks own no query client of their own).
 *
 * Token attach: the client re-reads the Clerk session token per request, and passes `forceRefresh` through
 * to the session's `getToken({ skipCache })` on any 401 retry it drives internally — the first-token
 * identity-sync-pending backoff, AND (B22) a bounded single retry after an ordinary expired-token 401 — so a token that
 * expired while backgrounded gets one chance to self-heal before the request fails.
 *
 * ⚠️ DELIBERATE — ADR-0054. Both clients are built per COOK (the memo is keyed on `userId`), mint from the LIVE session
 * of the one `useClerk()` instance, and go through `subjectBoundToken`, which mints only for the cook the client was
 * built for. `@clerk/expo`'s `useAuth().getToken` is a new function on every render, so clients keyed on it were rebuilt
 * on every render; its offline JWT cache runs only for a call with no options, and every call here passes the template,
 * so minting from the session directly loses nothing.
 *
 * ⚠️ The name promises a conditional render and there is none — it renders `children` unconditionally, so
 * "does it choose a subtree?" answers no and a reader can land on the render half. It is ORCHESTRATION: it
 * reads the Clerk session and binds it to the recipe client every hook in the subtree calls through, which
 * is the authorization seam for every recipe request the app makes.
 *
 * @pattern Adapter over the Clerk session — turns `getToken` into the per-request bearer (and the
 *     `forceRefresh` → `skipCache` retry) the recipe client's token seam asks for, and nothing else.
 */
import { useAuth, useClerk } from '@clerk/expo';
import { subjectBoundToken } from '@commise/features-account';
import { recipeSender } from '@commise/query/recipe-sender';
import { useQuerySessionScope } from '@commise/query/session-scope';
import { SyncProvider } from '@commise/query/sync';
import { FoodServiceClient } from '@kitchensink/food-service-client';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { useQueryClient } from '@tanstack/react-query';
import type { JSX, ReactNode } from 'react';
import { useMemo } from 'react';

import { NATIVE_JWT_TEMPLATE } from '../auth/nativeToken.js';
import { env } from '../config/env.js';
import { createNativeOutboxStore } from '../storage/outboxStore.js';

/** The device-backed outbox, built once — mobile is the platform that persists. */
const nativeOutboxStore = createNativeOutboxStore();

/**
 * Mount the recipe-service client provider for the subtree.
 *
 * @param props - The subtree to provide the client to.
 * @returns The provider-wrapped children.
 */
export function RecipeServiceGate({ children }: { readonly children: ReactNode }): JSX.Element {
    const { userId } = useAuth();
    // The one `IsomorphicClerk` for the app's life: the clients mint from its live session, and the proxy checks it.
    const clerk = useClerk();

    // ⚠️ DELIBERATE — ADR-0054. The app's query cache (mounted in `AppProviders`) ends with the cook's session. Mobile
    // keeps the process across a sign-out, so without this the next cook on the device reads the last one's cache.
    const queryClient = useQueryClient();
    useQuerySessionScope(queryClient, userId ?? undefined);

    // ⚠️ DELIBERATE — ADR-0054. Both clients per cook, and one bound mint between them, so recipe and food authenticate
    // the same way. An empty bearer while no session exists is answered `401`, which the query retry outlasts.
    const clients = useMemo(() => {
        const token = subjectBoundToken(
            userId ?? undefined,
            clerk,
            async (forceRefresh) =>
                (await clerk.session?.getToken({ template: NATIVE_JWT_TEMPLATE, skipCache: forceRefresh })) ?? '',
        );

        return {
            recipe: new RecipeServiceClient({
                // Required and validated at load — `localhost` on a phone is the PHONE, so a default here
                // could never have been right in a deployed build. See `../config/env.ts`.
                baseUrl: env.EXPO_PUBLIC_RECIPE_API_URL,
                token: (options) => token(options?.forceRefresh ?? false),
            }),
            // Plan 002 S5: foods and their variants are read from food-service directly, at its own origin.
            food: new FoodServiceClient({
                baseUrl: env.EXPO_PUBLIC_FOOD_API_URL,
                token: (options) => token(options?.forceRefresh ?? false),
            }),
        };
    }, [clerk, userId]);

    // The sender reads the client per call, so a new cook's sender sends with the new cook's client. A drain already
    // running holds the previous sender, whose client refuses to mint for the new cook (ADR-0054).
    const send = useMemo(() => recipeSender(() => clients.recipe), [clients]);

    // ⛔ THE QUEUE IS MOUNTED HERE, NOT IN `AppProviders`, and the reason is ownership rather than taste:
    // this component builds the recipe client, so it is the lowest point that HAS one and the highest point
    // below which every feature sits. Mounted above it, the queue had no client and its sender could only
    // throw — which is precisely how it shipped doing nothing.
    //
    // ⚠️ `subject` comes from the signed-in user, never a placeholder: the outbox is namespaced by it, and a
    // queue keyed by a constant is a cross-account read the first time a second person signs in on a device.
    // ⛔ THE ABSENT CASE IS THE PROVIDER'S, NOT A TERNARY HERE. Gating the mount changes the element type at
    // this position, so `AuthGate` resolving a user would unmount and REMOUNT the whole subtree — the same
    // defect that wiped the web recipe editor and failed six Playwright shards.
    return (
        <RecipeServiceProvider client={clients.recipe}>
            <FoodServiceProvider client={clients.food} subject={userId ?? undefined}>
                <SyncProvider subject={userId ?? undefined} send={send} store={nativeOutboxStore}>
                    {children}
                </SyncProvider>
            </FoodServiceProvider>
        </RecipeServiceProvider>
    );
}
