/**
 * The pure policy for a STAFF correction of a confirmed source answer (ADR-0099, plan everyAnswerSourceLock KTD-6).
 *
 * DESIGN PATTERN: **Specification / Policy module**, in the shape of `ingredients/domain/correctionScopePolicy.ts` and a sibling of
 * `evaluateSourceCorrection` (what a COOK may change). It answers from its inputs alone: no DB, no principal, no I/O. It is a policy
 * and not a route Guard (ADR-0023, DD18): what is authorized is a field value on a request, and the decision needs the locked row.
 *
 * ## The order is the contract
 *
 * `forbidden` first, from the caller's grants alone (no database work is done for a caller without the grant). The rest is decided
 * on the row the caller read UNDER the owner lock and the row lock, never on one read before them: `notFound` (no recipe, or the
 * confirmed `ownerAccountId` is not its owner: ONE answer, so the route never reveals an owner), `invalidTarget` (the recipe holds no
 * answer to correct, or its text is the curator's public domain), `unchanged` (the answer already stands, by kind and citation),
 * else `apply`.
 *
 * ## What a correction leaves
 *
 * The recipe is PRIVATE in every `apply`. The Public HOLD is set only where the correction itself could open Public: the new
 * answer is "I wrote this" or "from another person" (a recipe with no third-party source to refuse it), or the old answer was a paid
 * site (whose evidence is not the one the new answer's own evidence replaces). Everywhere else the recipe meets exactly the refusal
 * a cook who stated the new answer first would meet (qse Q-7); a hold there would refuse Public for a reason the cook never caused.
 *
 * @pattern Specification — one pure decision over the locked row and the request
 */
import { RecipeSourceType, type RecipeSourceKind, type RecipeStatementKind } from '@kitchensink/recipe-core';

import { resolveStatementProvenance, type ResolvedProvenance, type StatementAnswer } from './provenancePolicy.js';
import { SOURCE_CORRECT_SCOPE } from '../recipes.schema.js';
import { holdsAlready, restatesStored, type StoredSource } from './sourceCorrectionPolicy.js';

/** The answers a recipe can hold, as the correction names them. */
export type SourceAnswerKind = 'own' | 'person' | 'webPage' | 'book' | 'paidSite';

/** The facts of the recipe, read under the owner lock and the row lock. */
export interface CorrectableRecipe {
    readonly ownerId: string;
    readonly sourceType: RecipeSourceType;
    readonly sourceKind: RecipeSourceKind | null;
    readonly statementKind: RecipeStatementKind | null;
    readonly sourceUrl: string | null;
    readonly sourceAttribution: string | null;
}

/** What the policy decides. */
export type SourceCorrectionVerdict =
    | { readonly kind: 'forbidden' }
    | { readonly kind: 'notFound' }
    | { readonly kind: 'invalidTarget' }
    | { readonly kind: 'unchanged' }
    | {
          readonly kind: 'apply';
          /** The provenance to write. */
          readonly provenance: ResolvedProvenance;
          /** Whether the recipe is held off Public ({@link holdOf}). */
          readonly hold: boolean;
          /** The answer the recipe held and the one it now holds, for the record and the log. */
          readonly from: SourceAnswerKind;
          readonly to: SourceAnswerKind;
      };

/**
 * The answer a stored recipe holds, or `undefined` for a recipe holding none (no statement and no source) or the curator's
 * public-domain text (`imported_public` with no kind). Pure.
 *
 * @param recipe - The stored recipe's source facts.
 */
export function answerOf(
    recipe: Pick<CorrectableRecipe, 'sourceType' | 'sourceKind' | 'statementKind'>,
): SourceAnswerKind | undefined {
    switch (recipe.sourceKind) {
        case 'public_web':
            return 'webPage';
        case 'book':
            return 'book';
        case 'paid_site':
            return 'paidSite';
        case null:
            break;
    }

    if (recipe.statementKind === 'authored') {
        return 'own';
    }

    return recipe.statementKind === 'fromPerson' ? 'person' : undefined;
}

/** The answer a request names. Pure. */
function answerKindOf(answer: StatementAnswer): SourceAnswerKind {
    switch (answer.kind) {
        case 'authored':
            return 'own';
        case 'fromPerson':
            return 'person';
        case 'public_web':
            return 'webPage';
        case 'book':
            return 'book';
        case 'paid_site':
            return 'paidSite';
    }
}

/**
 * Whether a correction holds the recipe off Public: the new answer is "I wrote this" or "from another person", or the old answer
 * was a paid site. The ONE statement of the rule; the table test pins every cell. Pure.
 *
 * @param from - The answer the recipe held.
 * @param to - The answer it now holds.
 */
export function holdOf(from: SourceAnswerKind, to: SourceAnswerKind): boolean {
    return to === 'own' || to === 'person' || from === 'paidSite';
}

/**
 * Decide a staff correction. Pure.
 *
 * @param input.callerScopes - The caller's grants (`scopes` and `permissions` together).
 * @param input.recipe - The recipe read under the owner lock and the row lock, or `undefined` when none is active.
 * @param input.ownerAccountId - The owner the staff caller confirmed with the owner (the mailbox step of the runbook).
 * @param input.answer - The answer to write.
 * @returns The verdict.
 */
export function evaluateSourceCorrectionScope(input: {
    readonly callerScopes: readonly string[];
    readonly recipe: CorrectableRecipe | undefined;
    readonly ownerAccountId: string;
    readonly answer: StatementAnswer;
}): SourceCorrectionVerdict {
    const { callerScopes, recipe, ownerAccountId, answer } = input;

    if (!callerScopes.includes(SOURCE_CORRECT_SCOPE)) {
        return { kind: 'forbidden' };
    }

    if (recipe === undefined || recipe.ownerId !== ownerAccountId) {
        return { kind: 'notFound' };
    }

    const from = answerOf(recipe);

    if (from === undefined) {
        return { kind: 'invalidTarget' };
    }

    const provenance = resolveStatementProvenance(answer);

    // A web link that is not a usable source resolves to nothing: the request names no answer that can be written.
    if (provenance === undefined) {
        return { kind: 'invalidTarget' };
    }

    const stored: StoredSource = {
        sourceType: recipe.sourceType,
        sourceKind: recipe.sourceKind,
        statementKind: recipe.statementKind,
        clonedFromId: null,
        sourceAttribution: recipe.sourceAttribution,
        sourceUrl: recipe.sourceUrl,
        sourceConfirmed: true,
        attestedFromPerson: false,
    };

    if (restatesStored(answer, stored) || holdsAlready(provenance, stored)) {
        return { kind: 'unchanged' };
    }

    const to = answerKindOf(answer);

    return { kind: 'apply', provenance, hold: holdOf(from, to), from, to };
}

/** What the preview decides. */
export type SourceCorrectionPreviewVerdict =
    | { readonly kind: 'forbidden' }
    | { readonly kind: 'notFound' }
    | { readonly kind: 'found'; readonly answer: SourceAnswerKind | undefined };

/**
 * Decide the read-only preview a staff command shows before it applies (ADR-0099). The same order as
 * `evaluateSourceCorrectionScope`: `forbidden` from the grants alone, then ONE `notFound` for a missing recipe and a wrong owner,
 * so the preview can never be used to learn who owns a recipe. Pure.
 *
 * @param input.callerScopes - The caller's grants.
 * @param input.recipe - The recipe, or `undefined` when none is active.
 * @param input.ownerAccountId - The owner staff confirmed.
 */
export function evaluateSourceCorrectionPreview(input: {
    readonly callerScopes: readonly string[];
    readonly recipe: CorrectableRecipe | undefined;
    readonly ownerAccountId: string;
}): SourceCorrectionPreviewVerdict {
    const { callerScopes, recipe, ownerAccountId } = input;

    if (!callerScopes.includes(SOURCE_CORRECT_SCOPE)) {
        return { kind: 'forbidden' };
    }

    if (recipe === undefined || recipe.ownerId !== ownerAccountId) {
        return { kind: 'notFound' };
    }

    return { kind: 'found', answer: answerOf(recipe) };
}
