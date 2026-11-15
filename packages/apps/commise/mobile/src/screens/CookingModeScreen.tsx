/**
 * The cooking-mode screen: reads the recipe and the viewer, and hands `CookingScreen` the read and where each way out
 * goes. The same shape as the web cook route (`CookingRoute`), so one rule decides who is cooking on both platforms.
 *
 * The read is the SAME `recipeQueries(client).detail(id)` the recipe page reads. A 404 is "not available", any other
 * failure is "try again", which resets the boundary and reads again. TanStack's `focusManager` is driven by `AppState`
 * (`query/connectivity.ts`), so returning to the app refetches under a cook on a step; `useCookingRead` holds the first
 * ready read, so that refetch never moves them.
 *
 * @pattern Adapter — the route's params, session and query, to `CookingScreen`'s read and callbacks
 */
import { CookingScreen, useCookingRead, type CookingScreenProps } from '@commise/features-cooking/mobile';
import { claimedViewerIdOf, viewerIdOf, viewerKnown } from '@commise/features-recipes/detail';
import { QueryBoundary } from '@commise/query/boundary';
import { isOwner, makeViewer } from '@kitchensink/recipe-core';
import { isNotFoundError, recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { onlineManager, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import type { FC } from 'react';

import { useSessionClaims } from '../hooks/useSessionClaims.js';
import { useUserProfile } from '../hooks/useUserProfile.js';

/** Props for {@link CookingModeScreen}. */
export interface CookingModeScreenProps extends Pick<CookingScreenProps, 'onLeave' | 'onEdit' | 'onHome'> {
    /** The recipe being cooked. */
    readonly recipeId: string;
}

/**
 * The cooking screen's read boundary around the settled screen.
 *
 * @param props - The recipe id and where each way out goes.
 * @returns The cooking screen in the read's state.
 */
export const CookingModeScreen: FC<CookingModeScreenProps> = ({ recipeId, onLeave, onEdit, onHome }) => {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();
    const ways = { onLeave, onEdit, onHome };
    // ONE rule decides who is cooking, for the key below and for the hold inside: the detail page's `viewerIdOf`. A
    // different cook is a different session, so the settled subtree is keyed by it and built again.
    const sessionClaims = useSessionClaims();
    const profile = useUserProfile();
    const viewerId = viewerIdOf(claimedViewerIdOf(sessionClaims), profile.data?.user.id);
    const viewer = { id: viewerId, known: viewerKnown(viewerId, profile.isLoading) };
    const detail = recipeQueries(client).detail(recipeId);

    const readAgain = (): void => {
        void queryClient.invalidateQueries({ queryKey: detail.queryKey });
    };

    return (
        <QueryBoundary
            loading={<CookingScreen read={{ kind: 'pending', retry: readAgain }} {...ways} />}
            renderError={({ error, resetErrorBoundary }) => (
                <CookingScreen
                    read={
                        isNotFoundError(error)
                            ? { kind: 'gone' }
                            : { kind: 'failed', offline: !onlineManager.isOnline(), retry: resetErrorBoundary }
                    }
                    {...ways}
                />
            )}
            resetKeys={[recipeId]}
        >
            <SettledCooking
                key={`${recipeId}|${viewerId ?? ''}`}
                detail={detail}
                viewer={viewer}
                ways={ways}
                readAgain={readAgain}
            />
        </QueryBoundary>
    );
};

/** Props for {@link SettledCooking}. */
interface SettledCookingProps {
    readonly detail: ReturnType<ReturnType<typeof recipeQueries>['detail']>;
    /** Who is cooking, by the one rule in {@link CookingModeScreen}. */
    readonly viewer: { readonly id: string | undefined; readonly known: boolean };
    readonly ways: Pick<CookingScreenProps, 'onLeave' | 'onEdit' | 'onHome'>;
    readonly readAgain: () => void;
}

/**
 * The screen once the read has settled: the recipe, and who is looking at it. `useCookingRead` holds the first ready
 * read, so a later refetch that returns a draft, blank steps or a different status does not move a cook off their step.
 */
const SettledCooking: FC<SettledCookingProps> = ({ detail, viewer, ways, readAgain }) => {
    const { data: recipe } = useSuspenseQuery(detail);
    const read = useCookingRead({
        recipeId: recipe.id,
        subject: viewer.id,
        recipe: { id: recipe.id, title: recipe.title, status: recipe.status, steps: recipe.steps },
        failure: undefined,
        viewer: {
            known: viewer.known,
            isOwner: viewer.known && viewer.id !== undefined && isOwner(recipe, makeViewer({ id: viewer.id })),
        },
        retry: readAgain,
    });

    return <CookingScreen read={read} {...ways} />;
};
