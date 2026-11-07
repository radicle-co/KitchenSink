/**
 * @module @commise/ui/dialog-actions — platform-neutral barrel for the design-system `DialogActions`. The component
 * specifier resolves to its web (`DialogActions.tsx`) or native (`DialogActions.native.tsx`) leaf at bundle time; the
 * prop contract is platform-agnostic. Consumed as `@commise/ui/dialog-actions`.
 */
export { DialogActions } from './DialogActions.js';
export { dialogActionSlotClass } from './dialogActionsClass.js';
export type { DialogActionsProps, DialogActionsSideBySideFrom } from './props.js';
