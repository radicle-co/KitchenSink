/**
 * @module recipe-service/recipes/mappers — one stored row and the viewer's selected facts → the owner's `hiddenReason`.
 *
 * The one helper behind all four producers of a recipe item (detail, the owner's list, search, collection GET), so no
 * producer re-derives the rule. Pure: the ranking, the owner gate and the audience test are recipe-core's `hiddenReasonOf`.
 */
import { hiddenReasonOf, type HiddenReason } from '@kitchensink/recipe-core/recipe-state';

import { recipeRowToDomain, type RecipeRowInput } from './recipeRowToDomain.js';

/** What a producer selects beside the row (`ownerHeldFromReadersSql`, `cookSourceEvidenceOf`) plus who is reading. */
export interface HiddenReasonRowFacts {
    /** The requesting principal, or `undefined` for a caller with none: never the owner. */
    readonly viewerId: string | undefined;
    /** The read function's own answer for this row, as selected. REQUIRED: a producer that forgot it does not compile. */
    readonly ownerHeldFromReaders: boolean;
    /** The cook-evidence term, selected for the viewer's own rows (`false` otherwise). */
    readonly hasCookSourceEvidence: boolean;
}

/**
 * @param row - The recipe row, or a raw search row adapted to the same shape.
 * @param facts - The viewer and the two selected terms.
 * @returns The reason for the OWNER of a held public recipe, and `undefined` for everyone and everything else.
 */
export function hiddenReasonOfRow(
    row: RecipeRowInput & { readonly sourceCorrectionHold: boolean },
    facts: HiddenReasonRowFacts,
): HiddenReason | undefined {
    const recipe = recipeRowToDomain(row);

    return hiddenReasonOf({
        viewerIsOwner: facts.viewerId === recipe.ownerId,
        visibility: recipe.visibility,
        ownerHeldFromReaders: facts.ownerHeldFromReaders,
        sourceCorrected: row.sourceCorrectionHold,
        hasCookSourceEvidence: facts.hasCookSourceEvidence,
        sourceType: recipe.sourceType,
        sourceKind: recipe.sourceKind ?? null,
    });
}
