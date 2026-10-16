/**
 * @module @commise/features-account/danger — platform-neutral barrel for the account danger-zone building
 * blocks (CR-002 / U4b). The `AccountEraseDialog` specifier resolves to its web (`.tsx`) or native
 * (`.native.tsx`) leaf at bundle time; the model + messages layers are platform-agnostic. The apps compose
 * these into their account screens, and render closure through `@commise/ui`'s `ConfirmDialog` with the
 * `close` copy from `accountDangerMessages`.
 */
export { AccountEraseDialog } from './AccountEraseDialog.js';

export { accountDangerMessages } from './messages.js';
export type { AccountCloseMessages, AccountDangerMessages, AccountEraseMessages } from './messages.js';
export type { AccountEraseDialogProps, DonatableRecipe } from './model.js';
export { closeConfirmOf, closeRowOf } from './closeAccount.js';
export type { CloseConfirm, CloseFailure, CloseRow, CloseSequenceState } from './closeAccount.js';
export { useAccountEraseControl } from './useAccountEraseControl.js';
export type { AccountEraseControl } from './useAccountEraseControl.js';
export { useAccountEraseFlow } from './useAccountEraseFlow.js';
export type { AccountEraseFlowInput, EraseFlowRecipes } from './useAccountEraseFlow.js';
