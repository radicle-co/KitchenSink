/**
 * Whether the visibility policy refuses an import item's requested visibility, for the label its statement sets (ADR-0072 §9).
 *
 * DESIGN PATTERN: **Adapter** over the pure `evaluateVisibility` policy, and the ONE place the bulk import reads it from the
 * item side (the save reads it inside `RecipesService.create`). It judges the request against the provenance the cook's
 * STATEMENT sets — a book recipe against `imported_physical` — never against the cook's own recipes, which is what makes a
 * book or paid-site recipe unable to be public. Any label may be private (ADR-0077 §6), using a slot.
 *
 * It answers the LABEL question only, so it passes `hasAvailablePrivateSlot: true`. The slot question is the save's: it is
 * read under the per-user lock inside `create` (ADR-0073), and a free cook out of slots pauses the import through the port
 * in `privateSlots.port.ts`. Reading a slot count here, outside that transaction, is the race ADR-0073 forbids.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';

import type { ContainmentSubject } from '../../common/containmentPolicy.js';
import { evaluateVisibility } from '../../recipes/domain/visibilityPolicy.js';
import type { ImportVisibility } from '../dal/recipeImports.dal.js';
import { resolveStatementProvenance } from '../../recipes/domain/provenancePolicy.js';
import type { KnownImportStatement } from './importStatement.js';

/** What the policy needs to know about the cook. */
export interface VisibilityFacts extends ContainmentSubject {
    readonly isPremium: boolean;
}

/**
 * Whether the requested visibility is refused for the recipe the statement describes.
 *
 * @param facts - The cook: plan and containment.
 * @param statement - What the cook said about the recipe.
 * @param requested - The visibility the item would be saved with.
 * @returns `true` when the policy refuses it, or when the statement's link is not a usable source. Pure and total.
 */
export function visibilityRefusedFor(
    facts: VisibilityFacts,
    statement: KnownImportStatement,
    requested: ImportVisibility,
): boolean {
    const provenance = resolveStatementProvenance(statement);

    // A web statement whose link is not a usable source sets no label at all: refused either way, so it is never saved.
    if (provenance === undefined) {
        return true;
    }

    const decision = evaluateVisibility({
        principalKind: facts.principalKind,
        containment: facts.containment,
        sourceType: provenance.sourceType,
        sourceKind: provenance.sourceKind,
        isPremium: facts.isPremium,
        hasAvailablePrivateSlot: true,
        requested: requested === 'public' ? RecipeVisibility.PUBLIC : RecipeVisibility.PRIVATE,
    });

    return !decision.allowed;
}
