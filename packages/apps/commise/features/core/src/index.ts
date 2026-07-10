/**
 * @module @commise/features-core — Commise Home widget-surface contract + appShell DI tokens.
 *
 * Imported by both apps (web + mobile) and every `@commise/features-*` package.
 * Exposes the Home-widget contract types + zod validators, the pure
 * `curateHomeWidgets` composition function, and the ditox `appShell` token surface.
 */

export * from './contract.js';
export * from './curateHomeWidgets.js';
export * from './appShell.js';
