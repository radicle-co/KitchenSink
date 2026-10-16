/**
 * @module @commise/features-recipes/discovery — the discovery screen's shared controller and results view.
 *
 * A package-export entry (the one kind of barrel this repo keeps). The web route and the mobile tab each render
 * {@link DiscoveryScreen} and supply the two ports it takes: a {@link DiscoveryCriteriaStore} (the URL on web,
 * {@link useStateCriteriaStore} on mobile) and a {@link DiscoveryPlatform}.
 */
export { DiscoveryScreen } from './DiscoveryScreen.js';
export type { DiscoveryScreenProps } from './DiscoveryScreen.js';
export { useStateCriteriaStore } from './useStateCriteriaStore.js';
export type {
    DiscoveryBoundary,
    DiscoveryBoundaryProps,
    DiscoveryCriteriaState,
    DiscoveryCriteriaStore,
    DiscoveryPlatform,
} from './discoveryScreenModel.js';
