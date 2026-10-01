/**
 * @module @commise/ui/screen-reader-focus — package export for moving screen-reader focus. Native-only: on web,
 * DOM focus is moved with `.focus()` / `autoFocus`, a different API, so the specifier resolves to the native
 * leaves on every platform. Consumed as `@commise/ui/screen-reader-focus`.
 */
export { moveScreenReaderFocus, type ScreenReaderFocusTarget } from './moveScreenReaderFocus.native.js';
export { useScreenReaderFocusOnMount } from './useScreenReaderFocusOnMount.native.js';
export { useScreenReaderFocusOnSignal } from './useScreenReaderFocusOnSignal.native.js';
