import type { RecipeIngredientView } from '@kitchensink/recipe-core';

import { fnv1a32Hex } from './fnv1a32.js';
import { normalizeStepText } from './stepDigest.js';

/** The digest format version, the `l1` prefix of every digest. A later field list bumps it (ADR-0096). */
export const INGREDIENT_LINE_DIGEST_VERSION = 1;

/**
 * The cook-authored, unscaled fields of a recipe line, and nothing else. Every field derived at read time or
 * dependent on the viewer (`name`, `foodId`, `variant`, `resolutionStatus`, `sourceLine`, ...) is left out on purpose:
 * `name` is absent whenever food-service cannot be asked, so including it would untick every line during an outage.
 */
export type IngredientLineDigestInput = Pick<
    RecipeIngredientView,
    'ingredientId' | 'quantity' | 'unit' | 'displayText' | 'note' | 'preparation' | 'groupLabel'
>;

function quantityPart(quantity: IngredientLineDigestInput['quantity']): readonly (string | number)[] {
    switch (quantity.kind) {
        case 'exact':
            return ['exact', quantity.value];
        case 'range':
            return ['range', quantity.low, quantity.high];
        case 'absent':
            return ['absent'];
    }
}

function textPart(text: string | undefined): string | null {
    return text === undefined ? null : normalizeStepText(text);
}

/**
 * Hashes a recipe line's cook-authored content to a short change detector, so a tick follows its line (ADR-0096).
 * Pure, synchronous, no I/O.
 *
 * @param line - A stored, unscaled line.
 * @returns `l1:` and 8 lowercase hex chars of FNV-1a 32 over the JSON of `[ingredientId, quantity, unit, displayText,
 * note, preparation, groupLabel]`. An absent field is `null`, and each text is NFC, whitespace-collapsed and trimmed.
 */
export function ingredientLineDigest(line: IngredientLineDigestInput): string {
    const json = JSON.stringify([
        line.ingredientId,
        quantityPart(line.quantity),
        ...[line.unit, line.displayText, line.note, line.preparation, line.groupLabel].map(textPart),
    ]);

    return `l${INGREDIENT_LINE_DIGEST_VERSION}:${fnv1a32Hex(json)}`;
}
