/**
 * The public surface of the page reader, `@kitchensink/recipe-core/page-reader`.
 *
 * ⛔ A package-export barrel, which is the one place a barrel is allowed. It is NOT re-exported from the package's main
 * barrel on purpose: the recipe service's `*.schema.ts` files import that barrel, and the contract hash fingerprints the
 * source of everything it reaches, so adding this would change the service's contract for a change no client can see.
 */
export { MAX_PASTE_BYTES, PASTE_CARD_THRESHOLD_CHARS, classifyPaste } from './pageReader/pageCaps.js';
export type { PasteKind } from './pageReader/pageCaps.js';
export type { DetectedSource } from './pageReader/detectPageSource.js';
export type { PageCredit, PageEvidence } from './pageReader/pageEvidence.js';
export type { PageRecipe, PageRecipeStep } from './pageReader/pageRecipeCandidate.js';
export { readPastedContent } from './pageReader/readPastedContent.js';
export type { PasteChoice, PasteReadResult, PasteUnusableReason } from './pageReader/readPastedContent.js';
