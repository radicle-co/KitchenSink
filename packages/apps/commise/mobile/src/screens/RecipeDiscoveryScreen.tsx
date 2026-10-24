/**
 * Public-recipe discovery screen (mobile, T076 / US2 + FR-006, U7 overhaul, orchestration): the mobile host of the shared
 * `DiscoveryScreen` (`@commise/features-recipes/discovery`), which owns the frame, the search, the filters, the rails and
 * the results — the same code the web route runs, so the two platforms cannot drift on what a search is or what stays on
 * screen while a newer one is pending. This file supplies only what is mobile's:
 *
 * - **The criteria live in component state** (`useStateCriteriaStore`), seeded from `initialFilters` — a tag deep-link
 *   from a recipe detail (D6), which still runs through the SAME visibility-scoped search. Unlike web there is no URL.
 * - **The platform** (`nativeDiscoveryPlatform`): the plain read boundary, the calorie lookup, and `AsyncStorage` for the
 *   recent searches.
 * - **Navigation**: a selected card opens its detail through the navigator; the snackbar's Edit opens the copy. The
 *   route also supplies the large title's avatar action and the scroll host's bind for the screen's one scroller.
 *
 * @pattern Adapter — the mobile host's criteria store and platform plugged into the shared discovery screen
 */
import { DiscoveryScreen, useStateCriteriaStore } from '@commise/features-recipes/discovery';
import type { RecipeFilterState } from '@commise/features-recipes';
import type { HeaderAction } from '@commise/ui/large-title-header';
import type { ScrollBind } from '@commise/ui/scroll-host';
import type { JSX } from 'react';

import { nativeDiscoveryPlatform } from './nativeDiscoveryPlatform.js';

/** Props for {@link RecipeDiscoveryScreen}. */
export interface RecipeDiscoveryScreenProps {
    /** Invoked with a recipe id when a discovery row is activated (the navigator opens its detail). */
    readonly onSelectRecipe: (id: string) => void;
    /** Opens a saved copy in the editor: the Save a copy snackbar's Edit action. */
    readonly onEditRecipe: (id: string) => void;
    /**
     * Filters to pre-apply on first mount — e.g. a tag deep-link from a recipe detail (D6). Defaults to no filters. This
     * still runs through the SAME visibility-scoped search, so a deep-linked tag never surfaces a recipe the viewer
     * couldn't otherwise see.
     */
    readonly initialFilters?: RecipeFilterState;
    /** The large title's action: the avatar, which pushes Profile (slice 3). The route supplies it. */
    readonly headerAction?: HeaderAction;
    /** The bind for this screen's one vertical scroller, from its `ScrollHost` (`TabRootScreen`). */
    readonly scrollBind?: ScrollBind;
}

/**
 * The public-discovery screen.
 *
 * @param props - The selection callback the navigator wires to detail navigation, plus optional preset filters.
 * @returns The shared discovery screen over component-state criteria and the mobile platform.
 */
export function RecipeDiscoveryScreen({
    onSelectRecipe,
    onEditRecipe,
    initialFilters,
    headerAction,
    scrollBind,
}: RecipeDiscoveryScreenProps): JSX.Element {
    const criteria = useStateCriteriaStore(initialFilters);

    return (
        <DiscoveryScreen
            criteria={criteria}
            platform={nativeDiscoveryPlatform}
            onEditCopy={onEditRecipe}
            onSelectRecipe={onSelectRecipe}
            {...(headerAction === undefined ? {} : { headerAction })}
            {...(scrollBind === undefined ? {} : { scrollBind })}
        />
    );
}
