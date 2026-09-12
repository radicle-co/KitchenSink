/**
 * @module @commise/features-core — Commise Home widget-surface contract + appShell DI tokens.
 *
 * Imported by both apps (web + mobile) and every `@commise/features-*` package.
 * Exposes the Home-widget contract types + zod validators, the pure
 * `curateHomeWidgets` composition function, and the ditox `appShell` token surface.
 */

export { ROADMAP_CAPABILITIES, ROADMAP_CAPABILITY_VALUES } from './capabilities.js';
export type { RoadmapCapability } from './capabilities.js';
export {
    homeWidgetCurationContextSchema,
    homeWidgetDescriptorSchema,
    homeWidgetIdSchema,
    isLiveHomeWidget,
    isPlaceholderHomeWidget,
    liveHomeWidgetDescriptorSchema,
    placeholderHomeWidgetDescriptorSchema,
} from './contract.js';
export type {
    CurateHomeWidgets,
    HomeWidgetCurationContext,
    HomeWidgetDescriptor,
    HomeWidgetId,
    HomeWidgetLoader,
    LiveHomeWidgetDescriptor,
    PlaceholderHomeWidgetDescriptor,
} from './contract.js';
export { HOME_WIDGET_TIER_ORDER, curateHomeWidgets } from './curateHomeWidgets.js';
export {
    analyticsToken,
    clockToken,
    configToken,
    errorReporterToken,
    featureFlagsToken,
    homeWidgetToken,
    loggerToken,
    registerHomeWidget,
    resolveErrorReporter,
    resolveHomeWidgets,
} from './appShell.js';
export type {
    AddFeature,
    AppShellAnalytics,
    AppShellClock,
    AppShellConfig,
    AppShellFeatureFlags,
    AppShellLogger,
    ErrorReporter,
    IsoDateTimeString,
} from './appShell.js';
export { toDetailQueryView, toQueryStatus } from './queryStatus.js';
export type { DetailQueryFacts, DetailQueryView, QueryStatus } from './queryStatus.js';

// === Home chrome ===

export { HOME_NAV_ITEMS, isNavItemReachable, resolveHomeNav } from './homeNavigation.js';
export type { HomeNavItem, HomeNavItemId, ResolvedHomeNavItem } from './homeNavigation.js';
export { formatHomeDate } from './utils/formatDate.js';
export { initialsFor } from './utils/initials.js';
export { GREETING_BUCKETS, greetingBucketForHour } from './utils/timeOfDay.js';
export type { GreetingBucket } from './utils/timeOfDay.js';
export { DAYS_PER_WEEK, weekdayLabels } from './utils/weekdays.js';

// === Roadmap scaffolding (temporary; shrinks as 005–009 ship) ===

export {
    RECIPE_WIDGET_DEFAULT_WEIGHT_REFERENCE,
    ROADMAP_WIDGET_IDS,
    ROADMAP_WIDGET_SPECS,
    createRoadmapPlaceholders,
} from './roadmapWidgets.js';
export type { RoadmapWidgetId, RoadmapWidgetSpec } from './roadmapWidgets.js';
