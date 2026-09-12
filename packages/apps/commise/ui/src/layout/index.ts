/**
 * @module @commise/ui/layout — package export for the layout rules a screen frame or a sheet keys on
 * (`docs/design/compactHeightLayout.md`): compact height, the pinned-footer limit and media heights, as pure rules, and
 * the native hooks that read the window, the keyboard and layout events for them. The hooks are native only, so this
 * export names their `.native.js` files explicitly (the `@commise/ui/screen-reader-focus` precedent); no web app
 * imports it. The web `Sheet` reads its own web measurement hook from inside the package.
 */
export { COMPACT_HEIGHT_BELOW_DP, isCompactHeight, isFrameCollapsed } from './compactHeight.js';
export { MEDIA_MAX_WINDOW_FRACTION, carouselBox, mediaBoxHeight, type MediaBox } from './mediaBox.js';
export { isFooterUnpinned, type PinnedFooterMeasure } from './pinnedFooter.js';
export { useCompactHeight } from './useCompactHeight.native.js';
export { useFrameCollapsed } from './useFrameCollapsed.native.js';
export { useKeyboardHidden } from './useKeyboardHidden.native.js';
export { useKeyboardShown } from './useKeyboardShown.native.js';
export { usePinnedFooter, type PinnedFooter } from './usePinnedFooter.native.js';
