/**
 * @module @commise/ui/dialog-focus — barrel for the shared Radix focus-return hook. WEB ONLY: it reads
 * `document.activeElement` and calls `.focus()`, neither of which React Native has. The native surfaces
 * (`Modal`) do not need it — the platform returns focus itself. Consumed as `@commise/ui/dialog-focus`.
 */
export { useReturnFocusOnClose } from './useReturnFocusOnClose.js';
