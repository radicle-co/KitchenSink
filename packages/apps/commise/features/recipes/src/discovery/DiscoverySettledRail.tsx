'use client';

/**
 * @module @commise/features-recipes/discovery/DiscoverySettledRail — (orchestration) one browse rail's settled read: its cards, with
 * ONE nutrition batch for this rail. The rails settle at different moments, so a batch spanning all three would change as
 * each landed and re-batch the rails already showing figures.
 */
import { useSuspenseInfiniteQuery } from '@tanstack/react-query';
import type { FC } from 'react';

import { useDiscoveryPlatform } from './DiscoveryPlatformProvider.js';
import type { DiscoveryCardActions } from './discoveryScreenModel.js';
import type { DiscoverySearchRead } from './discoverySearchRead.js';
import { recipeIdPagesOf } from './model.js';
import { RecipeBrowseRailResults } from './RecipeBrowseRailResults.js';

/** Props for {@link DiscoverySettledRail}. */
export interface DiscoverySettledRailProps extends DiscoveryCardActions {
    /** The rail's suspense read. */
    readonly read: DiscoverySearchRead;
}

/**
 * One rail's settled read.
 *
 * @param props - The rail's read and the card actions.
 * @returns The rail's cards.
 */
export const DiscoverySettledRail: FC<DiscoverySettledRailProps> = ({ read, ...actions }) => {
    const rail = useSuspenseInfiniteQuery(read);
    const renderNutrition = useDiscoveryPlatform().useRenderNutrition(recipeIdPagesOf(rail.data.pages));

    return (
        <RecipeBrowseRailResults
            {...actions}
            results={rail.data.pages.flatMap((page) => page.results)}
            renderNutrition={renderNutrition}
        />
    );
};
