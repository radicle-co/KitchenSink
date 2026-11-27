/**
 * Why a recipe cannot be made public: the model's one refusal enum (4.5) and the pure `refusalOf` that answers it.
 * recipe-core owns the names. The wire value, the sentence and the "built" notes of each name are documentation, and the
 * doc generator keeps them.
 *
 * `refusalOf` judges the source facts a client and the server both hold. It keeps the order the recipe page uses today,
 * so a client that switches to it answers the same. The server judges the same facts in its own order (containment,
 * private-only, source conflict, from another person, correction) and is not wired to this yet (ADR-0103's wire window).
 * The two orders differ only when two refusals hold at once.
 *
 * @pattern Specification — a pure predicate-and-pick over facts the caller already holds
 */
import { fromPersonOf } from '../fromPerson.js';
import {
    privateRuleOf,
    RecipeSourceType,
    UNRECOGNISED_SOURCE_KIND,
    UNRECOGNISED_STATEMENT_KIND,
    type RecipeSourceKindView,
    type RecipeStatementKindView,
} from '../recipe.types.js';

/** Every refusal name of 4.5, each its own string. */
export const REFUSAL = {
    REFUSAL_POLICY_WEB_PAGE: 'REFUSAL_POLICY_WEB_PAGE',
    REFUSAL_POLICY_BOOK: 'REFUSAL_POLICY_BOOK',
    REFUSAL_POLICY_PAID_SITE: 'REFUSAL_POLICY_PAID_SITE',
    REFUSAL_FROM_PERSON: 'REFUSAL_FROM_PERSON',
    REFUSAL_SOURCE_CONFLICT: 'REFUSAL_SOURCE_CONFLICT',
    REFUSAL_SOURCE_CORRECTED: 'REFUSAL_SOURCE_CORRECTED',
    REFUSAL_STATEMENT_REQUIRED: 'REFUSAL_STATEMENT_REQUIRED',
    REFUSAL_PUBLIC_CONFIRMATION_REQUIRED: 'REFUSAL_PUBLIC_CONFIRMATION_REQUIRED',
    REFUSAL_API_WRITER_CONFIRMATION: 'REFUSAL_API_WRITER_CONFIRMATION',
    REFUSAL_NO_PRIVATE_SLOT: 'REFUSAL_NO_PRIVATE_SLOT',
    REFUSAL_SOURCE_LOCKED: 'REFUSAL_SOURCE_LOCKED',
    REFUSAL_PRIVATE_FOODS_ON_PUBLIC: 'REFUSAL_PRIVATE_FOODS_ON_PUBLIC',
    REFUSAL_PUBLISH_REQUIREMENTS: 'REFUSAL_PUBLISH_REQUIREMENTS',
    REFUSAL_CONTAINED: 'REFUSAL_CONTAINED',
    REFUSAL_CONTENT_NOT_APPROVED: 'REFUSAL_CONTENT_NOT_APPROVED',
    REFUSAL_DETECTED_NO_PRIVATE_SLOT: 'REFUSAL_DETECTED_NO_PRIVATE_SLOT',
    REFUSAL_PUBLIC_VERSION_COPY: 'REFUSAL_PUBLIC_VERSION_COPY',
    REFUSAL_UNRECOGNISED: 'REFUSAL_UNRECOGNISED',
    REFUSAL_NONE: 'REFUSAL_NONE',
} as const;

/** One refusal name, or `REFUSAL_NONE` for "nothing stops it". */
export type Refusal = keyof typeof REFUSAL;

/** Where a refusal is computed (4.5). */
export type RefusalComputedBy = 'both' | 'server' | 'client';

/**
 * The refusals `refusalOf` can answer, and the client's `PUBLIC_REFUSALS` reason string for each of the ones it shows
 * today. The reason strings are the model JSON's `reason`, held to the client by `publicRefusalNames.test.ts`.
 */
export const REFUSALS_OF_SOURCE = [
    ['REFUSAL_POLICY_WEB_PAGE', 'policy.webPage'],
    ['REFUSAL_POLICY_BOOK', 'policy.book'],
    ['REFUSAL_POLICY_PAID_SITE', 'policy.paidSite'],
    ['REFUSAL_FROM_PERSON', 'fromPerson'],
    ['REFUSAL_SOURCE_CONFLICT', 'sourceConflict'],
    ['REFUSAL_UNRECOGNISED', 'unrecognised'],
    ['REFUSAL_NONE', 'none'],
] as const satisfies readonly (readonly [Refusal, string])[];

/** The facts that decide it. Optional facts are absent for a client that cannot see them, and absent reads false. */
export interface RefusalFacts {
    readonly sourceType: RecipeSourceType;
    /** What the cook said the source is, `null` for none. A client reads a newer server's kind as `unrecognised`. */
    readonly sourceKind: RecipeSourceKindView | null;
    /** What the cook stated, `null` for nothing. Owner-only on the wire. */
    readonly statementKind: RecipeStatementKindView | null;
    /** Whether a recorded source holds the recipe out of Public (ADR-0095): the evidence rule, `publicNeedsCheck`. */
    readonly held: boolean;
    /** Whether a "from another person" attestation exists while no statement is stored (the server reads it; a client cannot). */
    readonly attestedFromPerson?: boolean;
    /** Whether a staff correction holds the recipe off Public (`HOLD_SOURCE_CORRECTED`). The owner-only flag `sourceCorrected`. */
    readonly sourceCorrected?: boolean;
    /** Whether the cook must still say where the recipe is from (`publicNeedsStatement`). */
    readonly statementRequired?: boolean;
}

function privateOnlyRefusalOf(sourceType: RecipeSourceType, sourceKind: RecipeSourceKindView | null): Refusal {
    // A kind this client cannot name is the closed answer, and it names no answer it cannot word.
    if (sourceKind === UNRECOGNISED_SOURCE_KIND) {
        return REFUSAL.REFUSAL_UNRECOGNISED;
    }

    switch (sourceType) {
        case RecipeSourceType.IMPORTED_PHYSICAL:
            return REFUSAL.REFUSAL_POLICY_BOOK;
        case RecipeSourceType.IMPORTED_PAID:
            return REFUSAL.REFUSAL_POLICY_PAID_SITE;
        case RecipeSourceType.IMPORTED_PUBLIC:
            return REFUSAL.REFUSAL_POLICY_WEB_PAGE;
        case RecipeSourceType.USER_CREATED:
            // Unreachable while `privateRuleOf` keeps `user_created` under the slots rule. Closed, not open, if it ever is.
            return REFUSAL.REFUSAL_UNRECOGNISED;
    }
}

/**
 * Why a recipe cannot be made public.
 *
 * Order: "From another person" first (its line wins over a held recipe); a statement kind this client cannot name; a rule
 * that is private only, split by the source; the evidence rule; a staff correction; a statement still owed; else nothing.
 *
 * @param facts - The recipe's source and statement, and the holds that apply.
 * @returns The first refusal that holds, or `REFUSAL_NONE`. Pure.
 */
export function refusalOf(facts: RefusalFacts): Refusal {
    if (fromPersonOf({ statementKind: facts.statementKind, attestedFromPerson: facts.attestedFromPerson === true })) {
        return REFUSAL.REFUSAL_FROM_PERSON;
    }

    if (facts.statementKind === UNRECOGNISED_STATEMENT_KIND) {
        return REFUSAL.REFUSAL_UNRECOGNISED;
    }

    if (privateRuleOf(facts.sourceType, facts.sourceKind) === 'privateOnly') {
        return privateOnlyRefusalOf(facts.sourceType, facts.sourceKind);
    }

    if (facts.held) {
        return REFUSAL.REFUSAL_SOURCE_CONFLICT;
    }

    if (facts.sourceCorrected === true) {
        return REFUSAL.REFUSAL_SOURCE_CORRECTED;
    }

    return facts.statementRequired === true ? REFUSAL.REFUSAL_STATEMENT_REQUIRED : REFUSAL.REFUSAL_NONE;
}
