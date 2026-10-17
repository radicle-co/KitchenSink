/**
 * The React seam that hands the app's configured {@link FoodServiceClient}, and the cook it acts for, to the food-service
 * hooks (plan 002 S5). Built with `createElement`, so this stays a `.ts` module, as the recipe client's provider is.
 *
 * It does not end a cook's reads when their session ends. Each app's root does that for the whole query cache, recipe
 * reads included (`@commise/query`'s `useQuerySessionScope`, ADR-0054), so a purge here would be a second, narrower
 * statement of the same rule.
 *
 * @pattern Dependency Injection — React context carries the one client, so a hook never builds a URL or reads a token
 */
import { createContext, createElement, useContext, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';

import type { FoodServiceClient } from '../client.js';

/** What the provider hands down. */
export interface FoodServiceContextValue {
    readonly client: FoodServiceClient;
    readonly subject: string | undefined;
}

/** The provider's context. Package-internal: the hooks read it, and `../hooks.ts` does not export it. */
export const FoodServiceContext = createContext<FoodServiceContextValue | null>(null);

/** Props for {@link FoodServiceProvider}. */
export interface FoodServiceProviderProps {
    /** A configured client: the food origin and the token source already injected. */
    readonly client: FoodServiceClient;
    /**
     * The signed-in cook's user id (Clerk `userId`), or `undefined` while no one is signed in. Required, so every mount
     * states whose reads these are: the per-cook reads are keyed on it.
     */
    readonly subject: string | undefined;
    readonly children: ReactNode;
}

/**
 * Provides a {@link FoodServiceClient} and the signed-in cook to the food-service hooks. Mount inside the app's
 * `QueryClientProvider`.
 *
 * @param props - The client, the cook and children.
 * @returns The provider element.
 */
export function FoodServiceProvider(props: FoodServiceProviderProps): ReactElement {
    const { client, subject, children } = props;

    // One value per client and cook, so a re-render of the app's root does not re-render every food read beneath it.
    const value = useMemo(() => ({ client, subject }), [client, subject]);

    return createElement(FoodServiceContext.Provider, { value }, children);
}

/**
 * Read the {@link FoodServiceClient} from context.
 *
 * @returns The provided client.
 * @throws {Error} when called outside a {@link FoodServiceProvider}.
 */
export function useFoodServiceClient(): FoodServiceClient {
    const value = useContext(FoodServiceContext);

    if (value === null) {
        throw new Error('useFoodServiceClient must be used within a <FoodServiceProvider>.');
    }

    return value.client;
}
