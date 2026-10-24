/**
 * `CollectionDetailBody`'s `afterHeader` slot: where the screen puts what must come right after the header and before the
 * members (the mobile screen's "view choice not saved" notice).
 *
 * Why a slot: the native header is the scroller's FIRST child, so the heading's layout is measured against the top of the
 * content and the pinned bar's title shows at the right scroll. That notice used to sit BEFORE the header, inside the
 * screen's scroller, and pushed the heading down; it now comes after the header through this slot.
 */
import { SnackbarHost } from '@commise/ui/snackbar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import type { CollectionWithRecipes } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { FC, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CollectionDetailBody } from '../CollectionDetailBody.js';
import { useCollectionDetail } from '../useCollectionDetail.js';

afterEach(cleanup);

const collection: CollectionWithRecipes = {
    id: 'col_9',
    ownerId: 'usr_1',
    name: 'Weeknight dinners',
    visibility: RecipeVisibility.PUBLIC,
    createdAt: '2026-04-01T09:00:00.000Z',
    updatedAt: '2026-04-01T09:00:00.000Z',
    recipes: [],
};

const Screen: FC<{ readonly afterHeader?: ReactNode }> = ({ afterHeader }) => {
    const detail = useCollectionDetail({
        collection,
        refreshNotice: undefined,
        paidFeatures: 'granted',
        viewChoice: undefined,
        onViewChoice: vi.fn(),
        nav: { onDeleted: vi.fn(), onCloned: vi.fn(), onCreateRecipe: vi.fn() },
    });

    return (
        <CollectionDetailBody
            detail={detail}
            onBack={vi.fn()}
            onSelectRecipe={vi.fn()}
            onViewSource={vi.fn()}
            PickerBoundary={({ children }) => <>{children}</>}
            {...(afterHeader === undefined ? {} : { afterHeader })}
        />
    );
};

const renderScreen = (afterHeader?: ReactNode) =>
    render(
        <QueryClientProvider client={new QueryClient()}>
            <RecipeServiceProvider client={createFakeRecipeServiceClient()}>
                <SnackbarHost>
                    <Screen {...(afterHeader === undefined ? {} : { afterHeader })} />
                </SnackbarHost>
            </RecipeServiceProvider>
        </QueryClientProvider>,
    );

describe('CollectionDetailBody — afterHeader', () => {
    it('draws what it is given after the header and before the members', () => {
        renderScreen(<p>Your view choice was not saved.</p>);
        const heading = screen.getByRole('heading', { name: 'Weeknight dinners' });
        const notice = screen.getByText('Your view choice was not saved.');
        const members = screen.getByText('No recipes here yet');

        expect(heading.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(notice.compareDocumentPosition(members) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('draws nothing extra without it', () => {
        renderScreen();

        expect(screen.queryByText('Your view choice was not saved.')).toBeNull();
        expect(screen.getByRole('heading', { name: 'Weeknight dinners' })).toBeTruthy();
    });
});
