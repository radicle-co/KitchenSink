/**
 * @module @commise/ui/field-reveal — package export for the native field reveal (`docs/design/rowEditorOpenDecisions.md`
 * E1): the context a field requests through, and the host's hook and space. The hook and the space are native only, so
 * this export names their `.native.js` files explicitly (the `@commise/ui/layout` precedent); no web app imports it.
 */
export { FieldRevealContext, type FieldRevealer, type RevealRequest, type RevealTarget } from './fieldRevealContext.js';
export { RevealSpacer, type RevealSpacerProps } from './RevealSpacer.native.js';
export { useFieldRevealHost, type FieldRevealHost } from './useFieldRevealHost.native.js';
