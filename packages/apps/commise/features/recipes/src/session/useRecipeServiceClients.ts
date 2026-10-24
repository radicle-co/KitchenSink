'use client';

/**
 * @module @commise/features-recipes/session — the recipe and food service clients bound to the signed-in cook, built
 * the same way on both apps.
 *
 * ⚠️ DELIBERATE — ADR-0054. Both clients are built per COOK: the memo is keyed on `userId`, and each client's token goes
 * through `subjectBoundToken`, which mints only for the cook the client was built for. One bound mint serves both
 * clients, so recipe and food authenticate the same way.
 *
 * ⛔ NO TOKEN MEANS NO REQUEST. A mint that yields `null`, `''` or `undefined` throws {@link RecipeAuthNotReadyError};
 * the token proxy wraps it in `TokenMintFailedError`, so the request is never sent. An empty `Bearer ` header is a
 * guaranteed `401` (`recipeAuthNotReady.ts`), and mobile used to send one. Do not restore a `?? ''` in a caller's mint.
 *
 * What stays in the app: the SDK (`useClerk`, `useAuth`), how a token is minted (web's `getToken`, mobile's JWT
 * template), the origins, and the provider tree around the result (`@commise/query` may not be imported from here).
 *
 * @pattern Factory (memoized per cook) over the two service clients, with a Protection Proxy on the one mint
 */
import { subjectBoundToken, type SessionSubjectSource } from '@commise/features-account';
import { FoodServiceClient } from '@kitchensink/food-service-client';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { useMemo } from 'react';

import { RecipeAuthNotReadyError } from './recipeAuthNotReady.js';

/** What {@link useRecipeServiceClients} needs from an app. */
export interface UseRecipeServiceClientsOptions {
    /** The signed-in cook (Clerk `userId`), or `undefined` while nobody is. */
    readonly userId: string | undefined;
    /** The identity client whose LIVE session the token proxy checks (`useClerk()` on either platform). */
    readonly clerk: SessionSubjectSource;
    /**
     * Mint a session token; `forceRefresh` skips the SDK's cache on a `401` retry. A missing token is `null`,
     * `undefined` or `''`, never an invented value. Must be stable across renders (`useCallback`), or the clients are
     * rebuilt on every render.
     */
    readonly mint: (forceRefresh: boolean) => Promise<string | null | undefined>;
    /** The recipe service origin. */
    readonly recipeBaseUrl: string;
    /** The food service origin. */
    readonly foodBaseUrl: string;
}

/** The two clients built for one cook. */
export interface RecipeServiceClients {
    readonly recipe: RecipeServiceClient;
    readonly food: FoodServiceClient;
}

/**
 * Build the recipe and food clients for the signed-in cook.
 *
 * @param options - The cook, the identity client, the app's mint and the two origins.
 * @returns The same clients while the cook, identity client, mint and origins are unchanged.
 */
export function useRecipeServiceClients(options: UseRecipeServiceClientsOptions): RecipeServiceClients {
    const { userId, clerk, mint, recipeBaseUrl, foodBaseUrl } = options;

    return useMemo(() => {
        const token = subjectBoundToken(userId, clerk, async (forceRefresh) => {
            const minted = await mint(forceRefresh);

            if (minted === null || minted === undefined || minted === '') {
                throw new RecipeAuthNotReadyError('The session produced no token');
            }

            return minted;
        });

        return {
            recipe: new RecipeServiceClient({
                baseUrl: recipeBaseUrl,
                token: async (request) => token(request?.forceRefresh === true),
            }),
            food: new FoodServiceClient({
                baseUrl: foodBaseUrl,
                token: async (request) => token(request?.forceRefresh === true),
            }),
        };
    }, [userId, clerk, mint, recipeBaseUrl, foodBaseUrl]);
}
