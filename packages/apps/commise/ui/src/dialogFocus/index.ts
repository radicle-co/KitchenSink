/**
 * @module @commise/ui/dialog-focus — package export for the web focus moves: the shared Radix focus-return hook, `focusIfLost`, and
 * `useFocusOnSignal`. WEB ONLY: it reads
 * `document.activeElement` and calls `.focus()`, neither of which React Native has. The native surfaces
 * (`Modal`) do not need it — the platform returns focus itself. Consumed as `@commise/ui/dialog-focus`.
 */
export { focusIfLost } from './focusIfLost.js';
export { useFocusOnSignal } from './useFocusOnSignal.js';
export { useReturnFocusOnClose } from './useReturnFocusOnClose.js';
