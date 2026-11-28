/**
 * Two rules about a recipe's source that more than one layer must read the same way (ADR-0089).
 *
 * DESIGN PATTERN: **Specification**. Each is one authoritative, pure statement: the service policy, the editor and the
 * erasure worker import it, so none of them keeps its own copy.
 */
import { fromPersonOf } from './fromPerson.js';
import {
    RECIPE_SOURCE_KINDS,
    RecipeSourceType,
    UNRECOGNISED_SOURCE_KIND,
    UNRECOGNISED_STATEMENT_KIND,
    privateRuleOf,
    type RecipeSourceKind,
    type RecipeSourceKindView,
    type RecipeStatementKindView,
} from './recipe.types.js';

/** The facts of a stored recipe that decide whether its source can still change. The first publish is not one of them. */
export interface CorrectableSourceFacts {
    readonly sourceType: RecipeSourceType;
    /** What the cook said the source is, or `null`. A client may hold one it does not know. */
    readonly sourceKind: RecipeSourceKindView | null;
    /** What the cook stated (`recipes.statement_kind`), or `null`. A client may hold one it does not know. */
    readonly statementKind: RecipeStatementKindView | null;
    /** The recipe this one was cloned from, or `null`/`undefined` for an original. */
    readonly clonedFromId: string | null | undefined;
    /** Whether the answer is confirmed (`recipes.source_confirmed_at` is set, migration 0092): the lock the cook cannot lift. */
    readonly sourceConfirmed: boolean;
    /**
     * Whether the recipe holds a past "from another person" attestation while it stores no statement (a recipe cleared before the
     * lock existed, P7). The service reads it under the lock. The wire carries no attestation fact, so a client leaves it out and
     * the server's refusal is the answer there.
     */
    readonly attestedFromPerson?: boolean;
}

/**
 * What the cook may still do to a recipe's source (ADR-0100).
 *
 * - `open`: set, replace or clear it.
 * - `downgradeOnly`: a confirmed "I wrote this", which may only become a book or a paid site (the recipe is then private).
 * - `locked`: only Commise changes it.
 */
export type SourceLock = 'open' | 'downgradeOnly' | 'locked';

/**
 * How far the cook can still change this recipe's source. Pure, and the one rule the service policy and the editor both read.
 *
 * Locked whatever `sourceConfirmed` says (the locks that came before the confirmation): "From another person" or a statement
 * this client does not know (it fails closed), a source the cook did not state in the editor (the curator's public-domain
 * text, a paid site), a source INHERITED by a clone (a clone with a kind: otherwise cloning a public recipe would relabel it), and
 * a kind this client does not know.
 *
 * Then, by the confirmation: an unconfirmed answer is `open`, and so is a confirmed recipe with no answer at all. A confirmed
 * answer is `locked`, except a confirmed "I wrote this", which is `downgradeOnly`.
 *
 * @param recipe - The stored recipe's source facts.
 * @returns How far the source can change.
 */
export function sourceLockOf(recipe: CorrectableSourceFacts): SourceLock {
    if (
        recipe.sourceKind === UNRECOGNISED_SOURCE_KIND ||
        fromPersonOf({ statementKind: recipe.statementKind, attestedFromPerson: recipe.attestedFromPerson === true }) ||
        recipe.statementKind === UNRECOGNISED_STATEMENT_KIND
    ) {
        return 'locked';
    }

    // A book is the cook's statement too, whether stated in the editor or saved by an import. A paid-site source is locked whoever stated it.
    const statedInTheEditorOrNone =
        recipe.sourceType === RecipeSourceType.USER_CREATED ||
        recipe.sourceKind === 'public_web' ||
        recipe.sourceKind === 'book';
    const inheritedByClone =
        recipe.clonedFromId !== null && recipe.clonedFromId !== undefined && recipe.sourceKind !== null;

    if (!statedInTheEditorOrNone || inheritedByClone) {
        return 'locked';
    }

    if (!recipe.sourceConfirmed) {
        return 'open';
    }

    if (recipe.sourceKind !== null) {
        return 'locked';
    }

    if (recipe.statementKind === null) {
        return 'open';
    }

    return recipe.statementKind === 'authored' ? 'downgradeOnly' : 'locked';
}

/**
 * The key a query matches a row's source by: `<sourceType>:<sourceKind>`, with an empty kind for none. ONE function builds
 * it, here for {@link PRIVATE_ONLY_SOURCE_KEYS} and in SQL as `source_type || ':' || COALESCE(source_kind, '')`.
 *
 * @param sourceType - The recipe's provenance label.
 * @param sourceKind - What the cook said the source is, or `null`.
 * @returns The key. Pure.
 */
export function privateOnlySourceKey(sourceType: RecipeSourceType, sourceKind: RecipeSourceKind | null): string {
    return `${sourceType}:${sourceKind ?? ''}`;
}

/**
 * The private-only rule as DATA: the key of every `(sourceType, sourceKind)` pair, `null` kind included, for which
 * {@link privateRuleOf} answers `privateOnly`. DERIVED over the cross product, so the TypeScript rule and what a query
 * matches cannot drift.
 *
 * Account erasure binds it as a parameter to keep a private-only recipe out of the donated set (a donation makes a recipe
 * public). It is data and not SQL text: no query text crosses the package boundary, and nothing is spliced into a statement.
 */
export const PRIVATE_ONLY_SOURCE_KEYS: readonly string[] = Object.values(RecipeSourceType).flatMap((sourceType) =>
    [...RECIPE_SOURCE_KINDS, null]
        .filter((sourceKind) => privateRuleOf(sourceType, sourceKind) === 'privateOnly')
        .map((sourceKind) => privateOnlySourceKey(sourceType, sourceKind)),
);

/** {@link PRIVATE_ONLY_SOURCE_KEYS} as the ONE jsonb parameter every query that binds them takes (ADR-0105). */
export const PRIVATE_ONLY_SOURCE_KEYS_JSON: string = JSON.stringify(PRIVATE_ONLY_SOURCE_KEYS);

/**
 * The grounds a staff correction may name (ADR-0100). One value now: staff confirmed the owner's request through a challenge to
 * the account's verified email, which is a staff assertion and not something code can check. Spec 016 adds third-party grounds.
 * The service's wire, the `recipe_source_corrections` CHECK and the runbook read this one list.
 */
export const SOURCE_CORRECTION_GROUNDS = ['ownerConfirmedByAccountEmail'] as const;

/** One correction ground. */
export type SourceCorrectionGround = (typeof SOURCE_CORRECTION_GROUNDS)[number];

/** The longest reason a correction records. The reason is stored for audit and never logged. */
export const SOURCE_CORRECTION_REASON_MAX_LENGTH = 1000;
