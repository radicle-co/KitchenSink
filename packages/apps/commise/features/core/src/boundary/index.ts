/**
 * @module @commise/features-core/boundary — the route and error-boundary states both apps show, with their copy.
 *
 * A package-export entry (the one kind of barrel this repo keeps): `@commise/features-core/boundary`. The notice composes
 * the design system's `StateNotice`, a platform pair, so it resolves to the web or native layout at bundle time.
 */
export { BoundaryErrorNotice, type BoundaryErrorNoticeProps } from './BoundaryErrorNotice.js';
export { boundaryMessages, type BoundaryMessages } from './messages.js';
