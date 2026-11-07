/**
 * `CollectionDetailBody` on native: where each part sits from the screen's left edge. The screen no longer pads its
 * content, so the body must put every part at the 16 pt gutter ITSELF, and exactly once. `LargeTitleHeader` insets its
 * own title 16, so a body that also pads around it would move the title in twice (32), and one that cancels the screen's
 * padding with a negative margin would leave the title and everything under it on the edge (0).
 */
import { SnackbarHost } from '@commise/ui/snackbar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import type { CollectionWithRecipes } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sideInsetOf } from '@commise/test-utils';
import { CollectionDetailBody } from '../CollectionDetailBody.js';
import { useCollectionDetail } from '../useCollectionDetail.js';
import { render } from '@commise/ui/testing/tamagui';

afterEach(cleanup);

const GUTTER = 16;

const collection: CollectionWithRecipes = {
    id: 'col_9',
    ownerId: 'usr_1',
    name: 'Weeknight dinners',
    description: 'Quick things for school nights.',
    visibility: RecipeVisibility.PUBLIC,
    createdAt: '2026-04-01T09:00:00.000Z',
    updatedAt: '2026-04-01T09:00:00.000Z',
    recipes: [],
};

const Screen: FC = () => {
    const detail = useCollectionDetail({
        collection,
        refreshNotice: undefined,
        paidFeatures: 'granted',
        viewChoice: undefined,
        onViewChoice: vi.fn(),
        nav: { onDeleted: vi.fn(), onCloned: vi.fn(), onCreateRecipe: vi.fn() },
    });

    // The bare container the screen's ScrollView now is: no padding of its own.
    return (
        <CollectionDetailBody
            detail={detail}
            onBack={vi.fn()}
            onSelectRecipe={vi.fn()}
            onViewSource={vi.fn()}
            PickerBoundary={({ children }) => <>{children}</>}
            afterHeader={<p>Your view choice was not saved.</p>}
        />
    );
};

const renderBody = () =>
    render(
        <QueryClientProvider client={new QueryClient()}>
            <RecipeServiceProvider client={createFakeRecipeServiceClient()}>
                <SnackbarHost>
                    <Screen />
                </SnackbarHost>
            </RecipeServiceProvider>
        </QueryClientProvider>,
    );

describe('CollectionDetailBody (native) — one 16 pt side inset', () => {
    it('insets the title once: its own 16, and nothing around it', () => {
        renderBody();

        expect(sideInsetOf(screen.getByRole('heading', { name: 'Weeknight dinners' }))).toBe(GUTTER);
    });

    it('pads the header’s own lines (meta, description, Add recipes) by the gutter', () => {
        renderBody();

        expect(sideInsetOf(screen.getByText('Public'))).toBe(GUTTER);
        expect(sideInsetOf(screen.getByText('Quick things for school nights.'))).toBe(GUTTER);
        // The header's button is the first; the empty members state offers another.
        const [headerAdd] = screen.getAllByRole('button', { name: 'Add recipes' });
        expect(sideInsetOf(headerAdd as HTMLElement)).toBe(GUTTER);
    });

    it('pads what comes after the header — the notice slot and the members — by the gutter', () => {
        renderBody();

        expect(sideInsetOf(screen.getByText('Your view choice was not saved.'))).toBe(GUTTER);
        expect(sideInsetOf(screen.getByText('No recipes here yet'))).toBe(GUTTER);
    });
});
