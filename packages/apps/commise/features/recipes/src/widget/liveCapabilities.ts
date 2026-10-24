/**
 * @module @commise/features-recipes/widget — the capabilities whose backing service is live.
 *
 * One app-wide fact read in two places on each platform: Home's widget curation (`curateHomeWidgets` reveals a
 * feature's widget once its capability is here) and the navigation (`resolveHomeNav` decides which destinations are
 * reachable). Only the recipe service ships now; each feature (005–009) adds its capability here when it deploys.
 * It lives beside {@link RECIPE_HOME_WIDGET_CAPABILITY} because `features-core` must not depend on recipes.
 */
import { RECIPE_HOME_WIDGET_CAPABILITY } from '../descriptor.js';

export const LIVE_CAPABILITIES: readonly string[] = [RECIPE_HOME_WIDGET_CAPABILITY];
