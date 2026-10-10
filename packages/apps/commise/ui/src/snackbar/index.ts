/**
 * @module @commise/ui/snackbar — the `@commise/ui/snackbar` package export: the app's one `SnackbarHost` (its web or
 * native leaf, resolved at bundle time), `useSnackbar` for screens, and the shared contract.
 */
export { SnackbarHost } from './SnackbarHost.js';
export { UndoSnackbar } from './UndoSnackbar.js';
export { isSnackbarHostMissingError, SnackbarHostMissingError } from './snackbarContext.js';
export { useSnackbar } from './useSnackbar.js';
export { DEFAULT_SNACKBAR_MS } from './props.js';
export type { SnackbarAction, SnackbarApi, SnackbarHostProps, SnackbarInput, UndoSnackbarProps } from './props.js';
