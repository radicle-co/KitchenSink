/**
 * The ordered set of ways to find a recipe on a page, and the chain that walks it.
 *
 * DESIGN PATTERN: **Chain of Responsibility** over **Strategies** (004 C-007), the chain being a module-scope array, which
 * is the **Registry**. The ORDER lives here and nowhere else, and each strategy sees only the {@link PageDocument}. A
 * strategy that finds something (a recipe, several, or one that breaks a limit) ends the chain: a later, weaker reading
 * never overrides a page's own structured data. Adding a way to read a page is one new element of the array.
 */
import { jsonLdRecipe } from './jsonLdRecipe.js';
import { microdataRecipe } from './microdataRecipe.js';
import type { PageDocument } from './pageDocument.js';
import type { RecipeExtraction } from './pageRecipeCandidate.js';

/** One way of finding a recipe on a page. */
export type RecipeExtractor = (page: PageDocument) => RecipeExtraction;

/** The extractors in the order they are tried: the page's JSON-LD first, then its microdata. */
export const RECIPE_EXTRACTORS: readonly RecipeExtractor[] = [jsonLdRecipe, microdataRecipe];

/**
 * Find the recipe on a page.
 *
 * @param page - The parsed paste.
 * @returns The first extractor's answer that is not `none`, else `none`. Pure.
 */
export function extractRecipe(page: PageDocument): RecipeExtraction {
    for (const extractor of RECIPE_EXTRACTORS) {
        const extraction = extractor(page);

        if (extraction.kind !== 'none') {
            return extraction;
        }
    }

    return { kind: 'none' };
}
