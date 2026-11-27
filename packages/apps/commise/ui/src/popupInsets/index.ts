/**
 * @module @commise/ui/popup-insets — package export for the chrome a page's popups keep clear of. Consumed as
 * `@commise/ui/popup-insets`.
 */
export type { PageColumn, PageColumnReader } from './pageColumn.js';
export { PageFootContext } from './pageFootContext.js';
export { ReportPageFootContext, type PageFootReport, type ReportPageFoot } from './reportPageFootContext.js';
export { PopupInsetsContext, type PopupInsets, type PopupInsetsReader } from './popupInsetsContext.js';
export { PopupInsetsProvider, type PopupInsetsProviderProps } from './PopupInsetsProvider.js';
export {
    PopupInsetsRegistryContext,
    type PopupInsetsEntry,
    type PopupInsetsRegistry,
    type PopupInsetsWatch,
} from './popupInsetsRegistry.js';
export { useResizeWatch } from './useResizeWatch.js';
export { useResizeWatchAll } from './useResizeWatchAll.js';
