/**
 * @module @commise/ui/overlay — package export for window overlays: the `OverlayHost` every sheet and dialog opens in,
 * and the dismiss vocabulary they share. Native only, as the `Modal` beneath it is. Consumed as `@commise/ui/overlay`.
 */
export { OverlayHost, type OverlayHostProps } from './OverlayHost.native.js';
export { useOverlayDismiss } from './overlayDismissContext.native.js';
export { answerWindowBack, DISMISS_ROUTES, type DismissRequest, type DismissRoute } from './dismissRoute.js';
