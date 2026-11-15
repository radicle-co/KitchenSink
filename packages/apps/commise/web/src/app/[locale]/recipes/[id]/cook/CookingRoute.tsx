'use client';

/**
 * The cook route's client orchestration (`/[locale]/recipes/[id]/cook`): it reads the recipe and the viewer, and
 * hands `CookingScreen` the read and where each way out goes.
 *
 * The read is the SAME `recipeQueries(client).detail(id)` the page prefetched, behind `ClientQueryBoundary`: a prefetch
 * that succeeded ships the screen in the server HTML; one that failed (the API down, or every mocked Playwright run)
 * ships the loading frame, and the browser reads after hydration. A 404 is S32; any other failure is
 * S29, whose Try again resets the boundary and reads again.
 *
 * The viewer is the detail page's one rule (`viewerIdOf`). Until it is known the screen is told
 * `pending`, so no cook-link decision is ever taken on a guess and nothing of the recipe is painted.
 *
 * Every way out REPLACES this route rather than pushing: browser Back from where the cook lands never re-enters cooking
 * mode, and steps push nothing (R-11).
 *
 * @pattern Adapter — the route's params, router, session and query, to `CookingScreen`'s read and callbacks
 */
import { useAuth } from '@clerk/nextjs';
import { CookingScreen, cookingReadSourceOf, useCookingRead } from '@commise/features-cooking/web';
import { claimedViewerIdOf, viewerIdOf, viewerKnown } from '@commise/features-recipes/detail';
import { isNotFoundError, recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { onlineManager, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import type { FC } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';
import { useUserProfile } from '@/hooks/useUserProfile';

import { useCookWays, type CookWays } from './useCookWays';

/** Props for {@link CookingRoute}. */
export interface CookingRouteProps {
    /** The recipe id from the `[id]` segment. */
    readonly id: string;
}

/**
 * The live cook route: the read boundary around the settled screen.
 *
 * @param props - The recipe id.
 * @returns The cooking screen in the read's state.
 */
export const CookingRoute: FC<CookingRouteProps> = ({ id }) => {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();
    const ways = useCookWays(id);
    // ONE rule decides who is cooking, for the key below and for the hold inside: the detail page's `viewerIdOf`. A
    // different cook is a different session, so the settled subtree is keyed by it and built again.
    const { sessionClaims } = useAuth();
    const profile = useUserProfile();
    const viewerId = viewerIdOf(claimedViewerIdOf(sessionClaims), profile.data?.user.id);
    const viewer = { id: viewerId, known: viewerKnown(viewerId, profile.isLoading) };
    // Built ONCE and handed to both sides, so the key the boundary checks for a prefetch and the read it gates agree.
    const detail = recipeQueries(client).detail(id);

    const readAgain = (): void => {
        void queryClient.invalidateQueries({ queryKey: detail.queryKey });
    };

    return (
        <ClientQueryBoundary
            prefetchedKeys={[detail.queryKey]}
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
            resetKeys={[id]}
        >
            <SettledCooking
                key={`${id}|${viewerId ?? ''}`}
                detail={detail}
                viewer={viewer}
                ways={ways}
                readAgain={readAgain}
            />
        </ClientQueryBoundary>
    );
};

/** Props for {@link SettledCooking}. */
interface SettledCookingProps {
    readonly detail: ReturnType<ReturnType<typeof recipeQueries>['detail']>;
    /** Who is cooking, by the one rule in {@link CookingRoute}. */
    readonly viewer: { readonly id: string | undefined; readonly known: boolean };
    readonly ways: CookWays;
    readonly readAgain: () => void;
}

/**
 * The screen once the read has settled: the recipe, and who is looking at it. `useCookingRead` holds the first ready
 * read, so a later refetch that returns a draft, blank steps or a different status does not move a cook off their step
 * (S20, R-15). A query ERROR with data present never reaches here: the boundary only throws before the first data.
 */
const SettledCooking: FC<SettledCookingProps> = ({ detail, viewer, ways, readAgain }) => {
    const { data: recipe } = useSuspenseQuery(detail);
    const read = useCookingRead(cookingReadSourceOf(recipe, viewer, readAgain));

    return <CookingScreen read={read} {...ways} />;
};
