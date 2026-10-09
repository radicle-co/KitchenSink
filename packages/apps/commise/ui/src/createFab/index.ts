/**
 * @module @commise/ui/create-fab — the `@commise/ui/create-fab` package export: the design-system `CreateFab` and the
 * face, presentation hook and web surface the interim create dial's trigger shares with it, each resolved to its web or
 * native leaf at bundle time; and the one presentation policy.
 */
export { CreateFab } from './CreateFab.js';
export { FabFace } from './FabFace.js';
export { useFabPresentation } from './useFabPresentation.js';
export { fabSurfaceClass } from './fabSurfaceClass.js';
export { FAB_HEIGHT_PX, FAB_RESERVED_BOTTOM_PX, fabPresentationOf } from './createFabPolicy.js';
export type { FabInputs, FabPresentation } from './createFabPolicy.js';
export type { CreateFabProps, FabFaceProps, FabSelf } from './props.js';
