/**
 * @module @commise/features-core — Commise Home widget-surface contract + appShell DI tokens.
 *
 * Imported by both apps (web + mobile) and every `@commise/features-*` package.
 * Exposes the Home-widget contract types + zod validators, the pure
 * `curateHomeWidgets` composition function, and the ditox `appShell` token surface.
 */

export * from './capabilities.js';
export * from './contract.js';
export * from './curateHomeWidgets.js';
export * from './appShell.js';
export * from './queryStatus.js';

// === Home chrome ===

export * from './homeNavigation.js';
export * from './utils/formatDate.js';
export * from './utils/initials.js';
export * from './utils/timeOfDay.js';
export * from './utils/weekdays.js';

// === Roadmap scaffolding (temporary; shrinks as 005–009 ship) ===

export * from './roadmapWidgets.js';
