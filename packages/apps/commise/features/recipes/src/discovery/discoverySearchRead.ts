/**
 * @module @commise/features-recipes/discovery/discoverySearchRead — the type of one discovery search read.
 */
import type { recipeQueries } from '@kitchensink/recipe-service-client';

/** The infinite query options one discovery search (or one rail) reads through. */
export type DiscoverySearchRead = ReturnType<ReturnType<typeof recipeQueries>['searchInfinite']>;
