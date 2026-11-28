/**
 * Why the owner of a public recipe is told it is Hidden: the one owner-only wire fact `hiddenReason`, decided once, here.
 *
 * Whether Hidden shows comes ONLY from `heldFromReaders`, the read function's own answer (`recipe_held_from_readers`), so
 * the owner's chip and the readers' not-found can never disagree, however the function's body changes. The terms only pick
 * the line: the correction hold wins, then a recorded source (cook evidence or a private-only label), and a recipe the
 * function holds for a term mapped here gets `other` (the chip, no line). The audience test lives here, not in a service.
 *
 * @pattern Specification — a pure predicate-and-pick over facts the caller already holds
 */
import { privateRuleOf, RecipeVisibility, type RecipeSourceKindView, type RecipeSourceType } from '../recipe.types.js';

/** The reasons an owner is told. `other` has no line: the chip alone. 020 and the report writer add their own. */
export type HiddenReason = 'sourceCorrected' | 'heldSource' | 'other';

/** The facts one recipe row and its viewer give. Every one is REQUIRED, so a producer that forgot one does not compile. */
export interface HiddenReasonFacts {
    readonly viewerIsOwner: boolean;
    readonly visibility: RecipeVisibility;
    /** The read function's own answer for this row (`recipe_held_from_readers`), as selected. */
    readonly heldFromReaders: boolean;
    /** `source_correction_hold`. */
    readonly sourceCorrected: boolean;
    /** `recipe_has_cook_source_evidence`, selected for the viewer's own rows. */
    readonly hasCookSourceEvidence: boolean;
    readonly sourceType: RecipeSourceType;
    readonly sourceKind: RecipeSourceKindView | null;
}

/**
 * The owner's reason, or `undefined` when there is none to tell: not the owner, a private audience, or a recipe the read
 * rule does not hold.
 */
export function hiddenReasonOf(facts: HiddenReasonFacts): HiddenReason | undefined {
    if (!facts.viewerIsOwner || facts.visibility !== RecipeVisibility.PUBLIC || !facts.heldFromReaders) {
        return undefined;
    }

    if (facts.sourceCorrected) {
        return 'sourceCorrected';
    }

    if (facts.hasCookSourceEvidence || privateRuleOf(facts.sourceType, facts.sourceKind) === 'privateOnly') {
        return 'heldSource';
    }

    return 'other';
}

/**
 * A client's narrowing of the open wire string: the reasons that have an owner line. `other`, a newer server's reason and
 * a malformed value all return `undefined`, so the chip shows and no line does.
 */
export function knownHiddenReasonOf(wire: string | undefined): Exclude<HiddenReason, 'other'> | undefined {
    return wire === 'sourceCorrected' || wire === 'heldSource' ? wire : undefined;
}
