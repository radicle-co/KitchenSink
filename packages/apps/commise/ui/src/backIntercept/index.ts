/**
 * @module @commise/ui/back-intercept — package export for the hardware-back seam: a host mounts
 * `BackInterceptProvider` and supplies its own back navigation; any descendant with unsaved
 * work installs a veto through `useBackIntercept`. Consumed as `@commise/ui/back-intercept`.
 *
 * Native-only for the React half: `BackHandler` is a React Native API with no web counterpart, so the
 * provider and the hook resolve to their `.native` leaves on every platform (the `screen-reader-focus` shape —
 * the leaves are named EXPLICITLY below rather than left to bundler resolution). The registry itself is pure
 * TypeScript and is exported for the same reason it is a separate module: it is testable without a platform.
 *
 * The web half of "warn before losing unsaved work" is a different mechanism entirely — the browser's own
 * `beforeunload` prompt — and lives with the surface that owns the draft, not here.
 */
export { BackInterceptProvider, type BackInterceptProviderProps } from './BackInterceptProvider.native.js';
export { useBackIntercept } from './useBackIntercept.native.js';
export {
    createBackInterceptRegistry,
    type BackInterceptHandler,
    type BackInterceptRegistry,
} from './backInterceptRegistry.js';
