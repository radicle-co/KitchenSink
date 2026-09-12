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
import { recipeSender } from '@commise/query/recipe-sender';
import { SyncProvider } from '@commise/query/sync';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
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
    const { getToken, userId } = useAuth();

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

    // ⛔ THE SENDER MUST NEVER OUTLIVE THE CLIENT IT SENDS WITH. `client` is rebuilt whenever Clerk's
    // `getToken` changes identity, so a sender that captured the first one would send a queued write with a
    // PREVIOUS user's token. Keying it on `client` makes that structural.
    const send = useMemo(() => recipeSender(() => client), [client]);

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
        <RecipeServiceProvider client={client}>
            <SyncProvider subject={userId ?? undefined} send={send} store={nativeOutboxStore}>
                {children}
            </SyncProvider>
        </RecipeServiceProvider>
    );
}
