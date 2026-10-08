/**
 * @module home/liveCapabilities — the capabilities whose backing service is live (mobile).
 *
 * One app-wide fact read in two places: Home's widget curation (`curateHomeWidgets` reveals a feature's widget once
 * its capability is here) and the app root's bottom tab bar (`resolveHomeNav` decides which destinations are
 * reachable). Only the recipe service ships now; each feature (005–009) adds its capability here when it deploys.
 */
import { RECIPE_HOME_WIDGET_CAPABILITY } from '@commise/features-recipes';

export const LIVE_CAPABILITIES: readonly string[] = [RECIPE_HOME_WIDGET_CAPABILITY];
