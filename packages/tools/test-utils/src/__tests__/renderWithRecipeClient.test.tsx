import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';

import { useMessages } from '@commise/i18n/react';
import type { LocalizedMessages } from '@commise/i18n';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { useRecipeServiceClient, useRecipes } from '@kitchensink/recipe-service-client/hooks';

import { renderWithRecipeClient } from '../renderWithRecipeClient.js';

afterEach(cleanup);

interface Copy {
    readonly title: string;
}

const messages: LocalizedMessages<Copy> = {
    en: { title: 'Recipes' },
    es: { title: 'Recetas' },
};

/**
 * Proves both the locale context and the recipe-client context are live for a component under the render.
 * `useRecipeServiceClient` throws (rather than returning null/undefined) when no provider is mounted, so a
 * successful render — reaching the `has-client` text at all — is itself the assertion that a provider exists.
 */
function Probe() {
    useRecipeServiceClient();

    return (
        <div>
            <span>{useMessages(messages).title}</span>
            <span>has-client</span>
        </div>
    );
}

/** Reads recipes through the REAL `useRecipes` hook, over whatever client the test supplies. */
function RecipeCount() {
    const query = useRecipes();

    if (query.isPending) {
        return <span>loading</span>;
    }

    if (query.isError) {
        return <span>error</span>;
    }

    return <span>count:{query.data.data.length}</span>;
}

describe('renderWithRecipeClient', () => {
    it('supplies both LocaleProvider and RecipeServiceProvider to the rendered tree', () => {
        const client = createFakeRecipeServiceClient();

        renderWithRecipeClient(<Probe />, client);

        expect(screen.getByText('Recipes')).toBeTruthy();
        expect(screen.getByText('has-client')).toBeTruthy();
    });

    it('honors an explicit locale option', () => {
        const client = createFakeRecipeServiceClient();

        renderWithRecipeClient(<Probe />, client, { locale: 'es' });

        expect(screen.getByText('Recetas')).toBeTruthy();
    });

    it('renders real recipe-service hooks over the supplied fake client (type-checked vi.spyOn stub)', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes').mockResolvedValue({
            data: [],
            page: 1,
            pageSize: 20,
            total: 0,
            hasMore: false,
        });

        renderWithRecipeClient(<RecipeCount />, client);

        await waitFor(() => expect(screen.getByText('count:0')).toBeTruthy());
    });

    it('returns RTL RenderResult (container is queryable)', () => {
        const client = createFakeRecipeServiceClient();

        const result = renderWithRecipeClient(<Probe />, client);

        expect(result.container.textContent).toContain('Recipes');
    });

    it('keeps the provider stack mounted across rerender(...) (wrapper option, not a one-shot nested tree)', () => {
        const client = createFakeRecipeServiceClient();

        const { rerender } = renderWithRecipeClient(<Probe />, client);
        expect(screen.getByText('has-client')).toBeTruthy();

        // A naive implementation that nests providers directly around `ui` (instead of RTL's `wrapper`
        // option) loses that wrapping on rerender — `useRecipeServiceClient` would then throw instead of
        // resolving `client` again, and this render would fail.
        rerender(<Probe />);

        expect(screen.getByText('has-client')).toBeTruthy();
    });
});
