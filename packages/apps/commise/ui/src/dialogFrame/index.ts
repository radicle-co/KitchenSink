/**
 * @module @commise/ui/dialog-frame — package export for the design-system centred dialog frame. Native only: the web
 * dialogs are Radix's, so the specifier resolves to the native leaf on every platform (the `@commise/ui/input`
 * precedent). Consumed as `@commise/ui/dialog-frame`.
 */
export { DialogFrame } from './DialogFrame.native.js';
export { DIALOG_CARD_MAX_WIDTH_DP } from './dialogFrameLayout.js';
export type { DialogFrameProps } from './props.js';
