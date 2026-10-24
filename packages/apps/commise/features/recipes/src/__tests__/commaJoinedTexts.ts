/**
 * @module test-utils/commaJoinedTexts — find a comma-joined variant label on screen (curated plan U15; origin Success
 * Criteria: "No surface on web or mobile shows a comma-joined variant label").
 *
 * It reads TEXT NODES only. An accessible name is an attribute, so the spoken form, which joins the parts with commas
 * on purpose (R27), is never counted. Each surface's test runs it twice: once over a subtree that holds such a label
 * in the cook's own words, to prove it finds one there, and once over the variant's dotted line.
 */
import type { IngredientVariantPart } from '@kitchensink/recipe-core';

/**
 * Every text node under `root` that shows two adjacent parts joined by a comma.
 *
 * @param root - The subtree to search.
 * @param parts - The variant's parts, in wire order.
 * @returns The text of each offending node.
 */
export function commaJoinedTexts(root: Element, parts: readonly IngredientVariantPart[]): readonly string[] {
    const pairs = parts.slice(1).map((part, index) => `${parts[index]?.text ?? ''}, ${part.text}`);
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const found: string[] = [];

    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = node.textContent ?? '';

        if (pairs.some((pair) => text.includes(pair))) {
            found.push(text);
        }
    }

    return found;
}
