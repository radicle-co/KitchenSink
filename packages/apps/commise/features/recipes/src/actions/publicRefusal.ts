/**
 * @module @commise/features-recipes/actions — why a recipe cannot be public (board P6, plan makePublicRefusalNotice).
 *
 * ONE pure function answers it. The recipe page's menu, the page's visibility slot and the editor's Public card, choice
 * and send all read it, so they cannot disagree about whether Public is offered or what is said when it is not. The
 * reason names are the recipe state model's (the recipe state model under `docs/architecture`, its `refusals`), so one vocabulary
 * serves the model and both surfaces.
 *
 * It composes recipe-core's `privateRuleOf` (ADR-0073 section 10) and restates none of it: a rule that says "private
 * only" is split here only into the reason the cook is told.
 *
 * Pure.
 *
 * @pattern Specification — a pure predicate-and-pick over facts the surface already holds
 */
import {
    privateRuleOf,
    RecipeSourceType,
    UNRECOGNISED_SOURCE_KIND,
    UNRECOGNISED_STATEMENT_KIND,
    type RecipeSourceKindView,
    type RecipeStatementKindView,
} from '@kitchensink/recipe-core';

import type { PublicRefusalMessages } from './messages.js';

/** The reasons a recipe cannot be public, in the state model's names, and `none` when nothing stops it. */
export const PUBLIC_REFUSALS = [
    'fromPerson',
    'unrecognised',
    'policy.webPage',
    'policy.book',
    'policy.paidSite',
    'sourceConflict',
    'none',
] as const;

/** Why a recipe cannot be public, or `none`. */
export type PublicRefusal = (typeof PUBLIC_REFUSALS)[number];

/** A reason that stops a recipe being public: every `PublicRefusal` but `none`. */
export type BlockingRefusal = Exclude<PublicRefusal, 'none'>;

/** The facts that decide it. */
export interface PublicRefusalFacts {
    readonly sourceType: RecipeSourceType;
    /** What the cook said the source is (ADR-0089), `null` for none. A client reads a newer server's kind as `unrecognised`. */
    readonly sourceKind: RecipeSourceKindView | null;
    /** What the cook stated about the recipe, `null` for nothing. OWNER-ONLY on the wire, so a non-owner never holds one. */
    readonly statementKind: RecipeStatementKindView | null;
    /** Whether a recorded source holds the recipe out of Public (ADR-0095): `publicNeedsCheck`, or a source conflict. */
    readonly held: boolean;
}

/** The reason for a rule that is private only, from the label and kind that put the recipe under it. */
function privateOnlyReasonOf(sourceType: RecipeSourceType, sourceKind: RecipeSourceKindView | null): PublicRefusal {
    // A kind this client cannot name is the closed answer, and it names no answer it cannot word.
    if (sourceKind === UNRECOGNISED_SOURCE_KIND) {
        return 'unrecognised';
    }

    switch (sourceType) {
        case RecipeSourceType.IMPORTED_PHYSICAL:
            return 'policy.book';
        case RecipeSourceType.IMPORTED_PAID:
            return 'policy.paidSite';
        case RecipeSourceType.IMPORTED_PUBLIC:
            return 'policy.webPage';
        case RecipeSourceType.USER_CREATED:
            // Unreachable while `privateRuleOf` keeps `user_created` under the slots rule. Closed, not open, if it ever is.
            return 'unrecognised';
    }
}

/**
 * Why a recipe cannot be public.
 *
 * Order: "From another person" first (its line wins over a held recipe); a statement kind this client cannot name; a
 * rule that is private only, split by the source; a held recipe; else nothing.
 *
 * @param facts - The recipe's source and statement, and whether a recorded source holds it.
 * @returns The reason, or `none` when Public may be offered. Pure.
 */
export function publicRefusalOf(facts: PublicRefusalFacts): PublicRefusal {
    if (facts.statementKind === 'fromPerson') {
        return 'fromPerson';
    }

    if (facts.statementKind === UNRECOGNISED_STATEMENT_KIND) {
        return 'unrecognised';
    }

    if (privateRuleOf(facts.sourceType, facts.sourceKind) === 'privateOnly') {
        return privateOnlyReasonOf(facts.sourceType, facts.sourceKind);
    }

    return facts.held ? 'sourceConflict' : 'none';
}

/**
 * {@link publicRefusalOf} for a STORED recipe, whose kind and statement are absent when the cook never gave one.
 *
 * @param recipe - The stored recipe's source facts.
 * @param held - Whether a recorded source holds the recipe out of Public.
 * @returns The reason, or `none`. Pure.
 */
export function publicRefusalOfStored(
    recipe: Pick<PublicRefusalFacts, 'sourceType'> & {
        readonly sourceKind?: RecipeSourceKindView | null | undefined;
        readonly statementKind?: RecipeStatementKindView | null | undefined;
    },
    held: boolean,
): PublicRefusal {
    return publicRefusalOf({
        sourceType: recipe.sourceType,
        sourceKind: recipe.sourceKind ?? null,
        statementKind: recipe.statementKind ?? null,
        held,
    });
}

/**
 * The line that says why a recipe stays private. Pure. An exhaustive switch over the reasons, so a new reason is a compile
 * error here until it has a key.
 *
 * @param reason - Why Public is refused, from {@link publicRefusalOf}.
 * @param lines - The reason lines.
 * @returns The line, or `undefined` for `none`: nothing stops Public, so nothing is said.
 */
export function publicRefusalLineOf(reason: PublicRefusal, lines: PublicRefusalMessages): string | undefined {
    switch (reason) {
        case 'fromPerson':
            return lines.fromPerson;
        case 'unrecognised':
            return lines.unrecognised;
        case 'policy.webPage':
            return lines.policyWebPage;
        case 'policy.book':
            return lines.policyBook;
        case 'policy.paidSite':
            return lines.policyPaidSite;
        case 'sourceConflict':
            return lines.sourceConflict;
        case 'none':
            return undefined;
    }
}
