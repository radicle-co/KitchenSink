/**
 * @module @commise/features-core/home — the Home surface logic both apps share: widget curation and the slot decision,
 * the once-per-session nudge and its context, the greeting, its shared copy, and the profile avatar's props.
 *
 * A package-export entry (the one kind of barrel this repo keeps). The apps keep what differs by platform: the
 * per-widget `ErrorBoundary` + `Suspense` JSX (this package carries no `react-error-boundary`), the roadmap skeletons,
 * the Sentry binding in `homeContainer`, and the layout around the widgets.
 */
export { homeGreetingOf } from './homeGreeting.js';
export type { HomeGreetingCopy } from './homeGreeting.js';
export { HomeNudgeContext, useHomeNudge } from './homeNudgeContext.js';
export type { HomeNudge } from './homeNudgeContext.js';
export { homeMessages } from './messages.js';
export type { HomeChromeMessages, HomeMessages } from './messages.js';
export { homeWidgetSlotOf } from './homeWidgetSlot.js';
export type { HomeWidgetSlot } from './homeWidgetSlot.js';
export { homeWidgetTierOf } from './homeWidgetTier.js';
export { profileAvatarPropsOf } from './profileAvatarProps.js';
export { useHomeWidgets } from './useHomeWidgets.js';
export type { HomeWidgetSlots, UseHomeWidgetsInput } from './useHomeWidgets.js';
export { useOncePerSessionNudge } from './useOncePerSessionNudge.js';
export type { OncePerSessionNudge } from './useOncePerSessionNudge.js';
export { createHomeContainer } from './createHomeContainer.js';
export type { CreateHomeContainerInput } from './createHomeContainer.js';
