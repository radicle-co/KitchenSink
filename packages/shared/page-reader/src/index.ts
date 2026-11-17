/**
 * The public surface of the page reader, `@kitchensink/page-reader`: a package-export barrel, the one place a barrel is
 * allowed.
 *
 * ⛔ A package of its own, not a part of `@kitchensink/recipe-core`: the recipe service's contract relies on recipe-core
 * being a leaf of zod and dependency-free parsers (`recipe-service/contract/__tests__/contract.test.ts`), and the reader
 * needs an HTML parser. It depends on recipe-core, never the other way.
 */
export { MAX_PASTE_BYTES, PASTE_CARD_THRESHOLD_CHARS, classifyPaste } from './pageCaps.js';
export type { PasteKind } from './pageCaps.js';
export type { DetectedSource } from './detectPageSource.js';
export type { PageAccess, PageCredit, PageEvidence } from './pageEvidence.js';
export type { PageRecipe, PageRecipeStep } from './pageRecipeCandidate.js';
export { readPastedContent } from './readPastedContent.js';
export type { ExtractionTier } from './pageRecipeCandidate.js';
export type { NotExtractableReason, PasteReadResult } from './readPastedContent.js';
