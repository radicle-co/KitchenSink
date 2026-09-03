/**
 * @module @kitchensink/docgen-components — the public surface of the component/design-token generator.
 *
 * Everything under `docs/generated/components` and `docs/generated/design` is DERIVED from this package.
 * Regenerate with `npm run docs:generate --workspace=packages/tools/docgen-components`; the committed output
 * is guarded by `tests/generatedOutput.integration.test.ts`, which runs in the ordinary `npm test` sweep.
 */
export { buildEntries } from './catalog.js';
export { kindFromSignals, layerSignalsOf, patternsFrom } from './classify.js';
export { COMPONENTS_OUT_DIR, COMPONENT_GROUPS, DESIGN_OUT_DIR, REPO_ROOT, SCHEMA_VERSION } from './config.js';
export type { ComponentGroup, GroupLayer, Platform } from './config.js';
export { discoverComponentFiles, isDocumentedComponentFile, isDocumentedDirectory } from './discovery.js';
export { parseDocblock, readDeclarationDocs, readLeadingDocblock, readModuleDocblock } from './docblock.js';
export type { Docblock } from './docblock.js';
export { DocgenError, isDocgenError } from './errors.js';
export { extractImplementations, loadCompilerOptions, platformOf, resolveTrimmedPath } from './extract.js';
export { collectFindings } from './findings.js';
export { buildArtifacts, readCommittedArtifacts, readGroup, writeArtifacts } from './generate.js';
export type { Coverage, GroupCatalogue } from './generate.js';
export type {
    ComponentEntry,
    ComponentImplementation,
    ComponentKind,
    DetectionSource,
    DocTag,
    DocumentedProp,
    Finding,
    FindingSeverity,
    LayerSignals,
} from './model.js';
export { toJsonText } from './serialize.js';
export { buildDesignTokens, tokenKindOf } from './tokens.js';
export type { DesignToken, DesignTokenDocument, DesignTokenGroup, TokenKind } from './tokens.js';
