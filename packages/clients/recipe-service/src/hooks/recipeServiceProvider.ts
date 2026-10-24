import { createContext, createElement, useContext } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { RecipeServiceClient } from '../client.js';

const RecipeServiceClientContext = createContext<RecipeServiceClient | null>(null);

/** Props for {@link RecipeServiceProvider}. */
export interface RecipeServiceProviderProps {
    /** A configured client (base URL + token already injected). */
    readonly client: RecipeServiceClient;
    readonly children: ReactNode;
}

/**
 * Provides a {@link RecipeServiceClient} to the recipe-service hooks. Mount inside the app's
 * `QueryClientProvider`.
 *
 * @param props - The client instance + children.
 */
export function RecipeServiceProvider(props: RecipeServiceProviderProps): ReactElement {
    return createElement(RecipeServiceClientContext.Provider, { value: props.client }, props.children);
}

/**
 * Read the {@link RecipeServiceClient} from context.
 *
 * @returns The provided client.
 * @throws {Error} when called outside a {@link RecipeServiceProvider}.
 */
export function useRecipeServiceClient(): RecipeServiceClient {
    const client = useContext(RecipeServiceClientContext);

    if (client === null) {
        throw new Error('useRecipeServiceClient must be used within a <RecipeServiceProvider>.');
    }

    return client;
}
