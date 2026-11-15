/**
 * What a cook pasted, read on their device into a recipe and a suggested source.
 *
 * DESIGN PATTERN: **Pipeline**. Size check → detect markup → parse → extract (the chain) → detect the source. Every
 * stage is pure, and the raw page never leaves the device: only the extracted recipe is sent (ADR-0072's rule that the
 * server receives recipes, not the file).
 *
 * ⛔ A hostile paste is bounded at every stage (`pageCaps.ts`): the size is checked in BYTES before anything is parsed
 * and an over-size paste is refused whole, never cut; parsing stops at a depth cap; JSON-LD is size-, count-, depth- and
 * node-bounded. Nothing is executed, fetched or logged, and no regular expression runs over the paste.
 *
 * ⚠️ {@link PageRecipe} is a plain shape, not the service's `ImportRecipe`: `@kitchensink/schema-recipe` depends on this
 * package. The caller parses it with `importRecipeSchema`, the check that a recipe's size and step limits hold.
 */
import { extractSourceLink } from '../sourceLink.js';
import { detectPageSource } from './detectPageSource.js';
import type { DetectedSource } from './detectPageSource.js';
import { MAX_PASTE_BYTES, fitsInBytes } from './pageCaps.js';
import { parsePage } from './pageDocument.js';
import type { PageRecipe, UnusableReason } from './pageRecipeCandidate.js';
import { extractRecipe } from './recipeExtractors.js';

/** Why a paste cannot be used: its recipe breaks a limit, or the page is nested too deeply to read all of it. */
export type PasteUnusableReason = UnusableReason | 'pageTooDeep';

/** What reading a paste came to. */
export type PasteReadResult =
    | { readonly kind: 'found'; readonly recipe: PageRecipe; readonly source: DetectedSource }
    | { readonly kind: 'several'; readonly titles: readonly string[] }
    | { readonly kind: 'none'; readonly source: DetectedSource }
    | { readonly kind: 'tooLarge'; readonly maxBytes: number }
    | { readonly kind: 'unusable'; readonly reason: PasteUnusableReason };

const NO_SOURCE: DetectedSource = { kind: 'none' };

/**
 * Read a paste.
 *
 * Text with no `<` is not a page: it goes straight to `none`, and a line that is only a link in it is the suggested
 * source (`extractSourceLink`, ADR-0089). A page goes through the extractor chain, and its source is the address it states
 * for itself.
 *
 * @param text - Everything the cook pasted.
 * @returns `found` (the recipe and a suggested source), `several` (the titles, for the cook to pick), `none` (no
 *   structured recipe, with any source found), `tooLarge` (over {@link MAX_PASTE_BYTES}), or `unusable`. Pure.
 */
export function readPastedContent(text: string): PasteReadResult {
    if (!fitsInBytes(text, MAX_PASTE_BYTES)) {
        return { kind: 'tooLarge', maxBytes: MAX_PASTE_BYTES };
    }

    if (!text.includes('<')) {
        const { link } = extractSourceLink(text);

        return { kind: 'none', source: link === undefined ? NO_SOURCE : { kind: 'found', citation: link } };
    }

    const page = parsePage(text);
    const extraction = extractRecipe(page);

    switch (extraction.kind) {
        case 'found':
            return { kind: 'found', recipe: extraction.recipe, source: detectPageSource(page, extraction.links) };
        case 'several':
            return { kind: 'several', titles: extraction.titles };
        case 'unusable':
            return { kind: 'unusable', reason: extraction.reason };
        case 'none':
            // A page cut short for depth may have held the recipe past the cut: say so rather than "no recipe".
            return page.truncated
                ? { kind: 'unusable', reason: 'pageTooDeep' }
                : { kind: 'none', source: detectPageSource(page, []) };
    }
}
