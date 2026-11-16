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
import { RecipeVisibility, fromPersonOf } from '@kitchensink/recipe-core';

import { isPremiumPrincipal, type Principal } from '../../auth/principal.js';
import type { ContainmentSubject } from '../../common/containmentPolicy.js';
import { evaluateVisibility } from '../../recipes/domain/visibilityPolicy.js';
import type { ImportVisibility } from '../dal/recipeImports.dal.js';
import { resolveStatementProvenance } from '../../recipes/domain/provenancePolicy.js';
import { evidenceListOf, sourceConflictOfEvidence } from '../../recipes/domain/sourceEvidence.js';
import type { KnownImportStatement } from './importStatement.js';

/** What the policy needs to know about the cook. */
export interface VisibilityFacts extends ContainmentSubject {
    readonly isPremium: boolean;
}

/**
 * The cook as the policy reads them: their containment and their plan. Pure.
 *
 * @param principal - The verified caller.
 */
export function visibilityFactsOf(principal: Principal): VisibilityFacts {
    return {
        principalKind: principal.principalKind,
        containment: principal.containment,
        isPremium: isPremiumPrincipal(principal),
    };
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
    // ⛔ An import saves Private only, until the paste import carries wordings and writes the attestation rows (ADR-0095 section 4).
    // A Public choice is refused here, so the item waits for the cook to choose Private. Nothing is changed for them: a save that
    // quietly turned Public into Private would be a recipe the cook did not ask for.
    if (requested === 'public') {
        return true;
    }

    const provenance = resolveStatementProvenance(statement);

    // A web statement whose link is not a usable source sets no label at all: refused either way, so it is never saved.
    if (provenance === undefined) {
        return true;
    }

    // The evidence the save will write for this statement (a new recipe has no other), so the question is the one the save asks.
    const decision = evaluateVisibility({
        principalKind: facts.principalKind,
        containment: facts.containment,
        sourceType: provenance.sourceType,
        sourceKind: provenance.sourceKind,
        isPremium: facts.isPremium,
        hasAvailablePrivateSlot: true,
        requested: RecipeVisibility.PRIVATE,
        sourceConflict: sourceConflictOfEvidence(evidenceListOf(provenance, 'importFile'), provenance),
        fromPerson: fromPersonOf({ statementKind: provenance.statementKind, attestedFromPerson: false }),
    });

    return !decision.allowed;
}
