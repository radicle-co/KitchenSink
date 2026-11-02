/**
 * `CollectionDetailBody`'s rename wiring: the rename sheet reports when it is off screen, and the ⋯ menu's trigger takes
 * focus back when the session asks. Without both, closing the sheet would leave focus on nothing (web) or lose the
 * screen-reader cursor (native) — the sheet's opener is a menu item that is gone by then.
 */
import { SnackbarHost } from '@commise/ui/snackbar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import type { CollectionWithRecipes } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sheetProps = vi.hoisted(() => ({
    latest: undefined as { onDismissed?: () => void; intent?: string } | undefined,
}));

vi.mock('../CollectionSheet.js', () => ({
    CollectionSheet: (props: { onDismissed?: () => void; intent?: string }) => {
        if (props.intent === 'rename') {
            sheetProps.latest = props;
        }

        return null;
    },
}));

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

const Screen: FC<{ readonly focus?: { requested: boolean; onHandled: () => void } }> = ({ focus }) => {
    const detail = useCollectionDetail({
        collection,
        refreshNotice: undefined,
        paidFeatures: 'granted',
        viewChoice: undefined,
        onViewChoice: vi.fn(),
        nav: { onDeleted: vi.fn(), onCloned: vi.fn(), onCreateRecipe: vi.fn() },
    });
    const session = focus === undefined ? detail : { ...detail, rename: { ...detail.rename, focusMenu: focus } };

    return (
        <CollectionDetailBody
            detail={session}
            onBack={vi.fn()}
            onSelectRecipe={vi.fn()}
            onViewSource={vi.fn()}
            PickerBoundary={({ children }) => <>{children}</>}
        />
    );
};

const renderScreen = (focus?: { requested: boolean; onHandled: () => void }) =>
    render(
        <QueryClientProvider client={new QueryClient()}>
            <RecipeServiceProvider client={createFakeRecipeServiceClient()}>
                <SnackbarHost>
                    <Screen {...(focus === undefined ? {} : { focus })} />
                </SnackbarHost>
            </RecipeServiceProvider>
        </QueryClientProvider>,
    );

describe('CollectionDetailBody — the rename sheet gives focus back to the menu', () => {
    it("takes the session's request on the ⋯ trigger and acknowledges it", () => {
        const onHandled = vi.fn();
        renderScreen({ requested: true, onHandled });

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More actions for Weeknight dinners' }));
        expect(onHandled).toHaveBeenCalledOnce();
    });

    it('lets the rename sheet report its dismissal to the session, which raises the request', () => {
        renderScreen();

        expect(sheetProps.latest?.onDismissed).toBeTypeOf('function');
    });
});
