/**
 * @module @commise/ui/create-fab — the `@commise/ui/create-fab` package export: the design-system `CreateFab`, resolved
 * to its web or native leaf at bundle time, and the one presentation policy. Its face, presentation hook and web surface
 * are its own parts; the interim create dial that also drew them is retired (D4, slice 8), so they are not exported.
 */
export { CreateFab } from './CreateFab.js';
export { FAB_HEIGHT_PX, FAB_RESERVED_BOTTOM_PX, fabPresentationOf } from './createFabPolicy.js';
export type { FabInputs, FabPresentation } from './createFabPolicy.js';
export type { CreateFabProps, FabSelf } from './props.js';
