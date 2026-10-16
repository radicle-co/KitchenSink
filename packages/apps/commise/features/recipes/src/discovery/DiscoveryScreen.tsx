'use client';

/**
 * @module @commise/features-recipes/discovery/DiscoveryScreen — public-recipe discovery (orchestration): the discovery
 * FRAME around a suspense read of the search, with the curated rails as the body while the viewer is browsing
 * (`docs/design/uiOverhaul/buildSpec.md` §4.4–§4.6). The web route and the mobile tab both render THIS; each supplies only
 * the {@link DiscoveryCriteriaStore} (URL / component state) and the {@link DiscoveryPlatform} (boundary, calorie lookup,
 * recent-search persistence), plus its own navigation.
 *
 * The frame (heading, search field, filters, back-to-browse, sort, the count line) sits outside the read boundary, so a
 * pending or failed search swaps only the results. The boundary's loading body is `RecipeDiscoveryLoading` in the card
 * variant the results will draw, its error body is `RecipeDiscoveryLoadError` over the PREVIOUS results, which stay, and
 * once settled the RESULTS render the rails or the counted grid. TanStack Query is the source of truth for the results.
 *
 * A retry from the results' refresh notice that succeeds moves focus to the frame's heading, across the boundary, as a
 * `useRecoverySignal` counter. Save a copy is `useSaveCopy`: each card derives its control from the clone mutation, and
 * the snackbar's Edit opens the copy.
 *
 * @pattern Layout slot — the persistent frame around a Suspense read boundary, with the criteria, the recent searches
 *     and the recovery counter lifted to the frame's side
 * @pattern Ports and Adapters — the criteria store and the platform are injected by each host
 */
import type { HeaderAction } from '@commise/ui/large-title-header';
import type { ScrollBind } from '@commise/ui/scroll-host';
import type { FC } from 'react';

import { DiscoveryPlatformProvider } from './DiscoveryPlatformProvider.js';
import { DiscoveryResultsView } from './DiscoveryResultsView.js';
import { DiscoverySettledResults } from './DiscoverySettledResults.js';
import type { DiscoveryCardActions, DiscoveryCriteriaStore, DiscoveryPlatform } from './discoveryScreenModel.js';
import { RecipeDiscoveryFrame } from './RecipeDiscoveryFrame.js';
import { RecipeDiscoveryLoadError } from './RecipeDiscoveryLoadError.js';
import { RecipeDiscoveryLoading } from './RecipeDiscoveryLoading.js';
import { useDiscoveryScreen } from './useDiscoveryScreen.js';

/** Props for {@link DiscoveryScreen}. */
export interface DiscoveryScreenProps extends Omit<DiscoveryCardActions, 'saveCopy'> {
    /** Where the shareable criteria live. */
    readonly criteria: DiscoveryCriteriaStore;
    /** The platform pieces. Pass a module constant. */
    readonly platform: DiscoveryPlatform;
    /** Opens a saved copy in the editor: the Save a copy snackbar's Edit action. */
    readonly onEditCopy: (copyId: string) => void;
    /** The large title's action (the avatar, which opens Profile). The app supplies it, since the profile read is its. */
    readonly headerAction?: HeaderAction;
    /** The bind for this screen's one vertical scroller, from its `ScrollHost` — native only. */
    readonly scrollBind?: ScrollBind;
}

/**
 * The discovery screen.
 *
 * @param props - The two ports, the navigation the host owns, and the optional title action and scroll bind.
 * @returns The discovery frame around the search's read boundary.
 */
export const DiscoveryScreen: FC<DiscoveryScreenProps> = ({
    criteria,
    platform,
    onEditCopy,
    onSelectRecipe,
    hrefOf,
    headerAction,
    scrollBind,
}) => {
    const screen = useDiscoveryScreen({
        criteria,
        recentSearchStore: platform.recentSearchStore,
        useRecoverySignal: platform.useRecoverySignal,
        onEditCopy,
    });
    const { Boundary } = platform;
    const resultsProps = {
        ...screen.results,
        saveCopy: screen.saveCopy,
        onSelectRecipe,
        ...(hrefOf === undefined ? {} : { hrefOf }),
        ...(scrollBind === undefined ? {} : { scrollBind }),
    };

    return (
        <DiscoveryPlatformProvider platform={platform}>
            <RecipeDiscoveryFrame {...screen.frame} {...(headerAction === undefined ? {} : { headerAction })}>
                <Boundary
                    prefetchedKeys={[screen.read.queryKey]}
                    resetKeys={[screen.settled]}
                    loading={<RecipeDiscoveryLoading variant={screen.cardVariant} />}
                    renderError={({ resetErrorBoundary }) => (
                        <RecipeDiscoveryLoadError
                            onRetry={resetErrorBoundary}
                            {...(screen.previous === undefined
                                ? {}
                                : {
                                      previous: (
                                          <DiscoveryResultsView
                                              {...resultsProps}
                                              pages={screen.previous.pages}
                                              criteria={screen.previous.criteria}
                                              stale={false}
                                          />
                                      ),
                                  })}
                        />
                    )}
                >
                    <DiscoverySettledResults read={screen.read} onRecovered={screen.onRecovered} {...resultsProps} />
                </Boundary>
            </RecipeDiscoveryFrame>
        </DiscoveryPlatformProvider>
    );
};
