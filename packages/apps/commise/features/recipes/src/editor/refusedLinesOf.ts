/**
 * @module @commise/features-recipes/editor — the refusal sheet's lines from a recipe's lines and the lines the server
 * refused (private foods spec section 7.2). Shared by the recipe page (its own lines) and the version history (the lines
 * of the version being restored), so the match rule lives once. Pure.
 */
import type { IngredientQuantity, PrivateFoodLine } from '@kitchensink/recipe-core';

import { matchRefusedLines } from '../foodPage/privateFoodsRefusal.js';
import { refusedLineParts } from './refusedLineText.js';
import type { RefusedLineView } from './privateFoodsRefusalSheetProps.js';

/** The parts of a recipe line the refusal reads. A recipe's line and a saved version's line both fit. */
export interface RefusableLine {
    readonly ingredientId?: string | undefined;
    readonly foodId?: string | undefined;
    readonly quantity: IngredientQuantity;
    readonly unit?: string | undefined;
    readonly displayText?: string | undefined;
    readonly name?: string | undefined;
}

/**
 * @param lines - A recipe's lines, in order (a line's position is its `sortOrder`).
 * @param refused - The lines the server named.
 * @param locale - The active locale, for the amount.
 * @returns The refused lines as the sheet lists them, in the order the lines hold them.
 */
export function refusedLinesOf(
    lines: readonly RefusableLine[],
    refused: readonly PrivateFoodLine[],
    locale: string,
): readonly RefusedLineView[] {
    const rows = lines.flatMap((line, index) =>
        line.foodId === undefined
            ? []
            : [{ rowId: line.ingredientId ?? String(index), foodId: line.foodId, sortOrder: index }],
    );

    return matchRefusedLines(refused, rows).map((row) => {
        const line = lines[row.sortOrder];

        return {
            rowId: row.rowId,
            foodId: row.foodId,
            ...(line === undefined ? { amount: '', words: '' } : refusedLineParts(line, locale)),
        };
    });
}
