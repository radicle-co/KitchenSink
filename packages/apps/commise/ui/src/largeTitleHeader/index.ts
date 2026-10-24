/**
 * @module @commise/ui/large-title-header — the `@commise/ui/large-title-header` package export: the design-system
 * `LargeTitleHeader`, `CondensedTitleBar` and `HeaderEyebrowBack`, each resolved to its web or native leaf at bundle time. Not `./layout`,
 * which is native-only.
 */
export { CondensedTitleBar } from './CondensedTitleBar.js';
export { HeaderEyebrowBack } from './HeaderEyebrowBack.js';
export { LargeTitleHeader } from './LargeTitleHeader.js';
export { PINNED_BAR_HEIGHT } from './barGeometry.js';
export { LARGE_SUBTITLE_CLASS, LARGE_TITLE_CLASS } from './largeTitleClass.js';
export type {
    CondensedTitleBarProps,
    CondensedTitleBarWebProps,
    HeaderAction,
    HeaderBack,
    LargeTitleHeaderProps,
} from './props.js';
