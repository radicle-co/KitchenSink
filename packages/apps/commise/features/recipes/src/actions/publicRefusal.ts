/**
 * @module @commise/features-recipes/actions — why a recipe cannot be public (board P6, plan makePublicRefusalNotice).
 *
 * ONE pure function answers it. The recipe page's menu, the page's visibility slot and the editor's Public card, choice
 * and send all read it, so they cannot disagree about whether Public is offered or what is said when it is not. The
 * reason names are the recipe state model's (the recipe state model under `docs/architecture`, its `refusals`), so one vocabulary
 * serves the model and both surfaces.
 *
 * It has no ordering of its own: it asks recipe-core's `refusalOf` (the model's one refusal function) and maps the answer
 * to this client's reason string through {@link REFUSALS_OF_SOURCE}.
 *
 * Pure.
 *
 * @pattern Specification — a pure predicate-and-pick over facts the surface already holds
 */
import type { RecipeSourceKindView, RecipeSourceType, RecipeStatementKindView } from '@kitchensink/recipe-core';
import { refusalOf, type Refusal } from '@kitchensink/recipe-core/recipe-state';

import type { PublicRefusalMessages } from './messages.js';

/** The reasons a recipe cannot be public, in the state model's names, and `none` when nothing stops it. */
export const PUBLIC_REFUSALS = [
    'fromPerson',
    'unrecognised',
    'policy.webPage',
    'policy.book',
    'policy.paidSite',
    'sourceConflict',
    'sourceCorrected',
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
    /** Whether a staff correction holds the recipe off Public for good (`sourceCorrected` on the wire, ADR-0100). */
    readonly sourceCorrected: boolean;
}

/**
 * The client reason string of each refusal name `refusalOf` can answer for the facts a client holds. The reasons are
 * `PUBLIC_REFUSALS`, and the model JSON's `reason` values, which `publicRefusalNames.test.ts` holds equal.
 */
export const REFUSALS_OF_SOURCE = [
    ['REFUSAL_POLICY_WEB_PAGE', 'policy.webPage'],
    ['REFUSAL_POLICY_BOOK', 'policy.book'],
    ['REFUSAL_POLICY_PAID_SITE', 'policy.paidSite'],
    ['REFUSAL_FROM_PERSON', 'fromPerson'],
    ['REFUSAL_SOURCE_CONFLICT', 'sourceConflict'],
    ['REFUSAL_SOURCE_CORRECTED', 'sourceCorrected'],
    ['REFUSAL_UNRECOGNISED', 'unrecognised'],
    ['REFUSAL_NONE', 'none'],
] as const satisfies readonly (readonly [Refusal, PublicRefusal])[];

/**
 * Why a recipe cannot be public.
 *
 * @param facts - The recipe's source and statement, and whether a recorded source holds it.
 * @returns The reason, or `none` when Public may be offered. A refusal this client has no words for (a flag it cannot see)
 *   reads `unrecognised`, which is closed. Pure.
 */
export function publicRefusalOf(facts: PublicRefusalFacts): PublicRefusal {
    const name = refusalOf(facts);

    return REFUSALS_OF_SOURCE.find((pair) => pair[0] === name)?.[1] ?? 'unrecognised';
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
        readonly sourceKind?: RecipeSourceKindView | null;
        readonly statementKind?: RecipeStatementKindView | null;
        readonly sourceCorrected?: boolean;
    },
    held: boolean,
): PublicRefusal {
    return publicRefusalOf({
        sourceType: recipe.sourceType,
        sourceKind: recipe.sourceKind ?? null,
        statementKind: recipe.statementKind ?? null,
        held,
        sourceCorrected: recipe.sourceCorrected === true,
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
        case 'sourceCorrected':
            return lines.sourceCorrected;
        case 'none':
            return undefined;
    }
}
