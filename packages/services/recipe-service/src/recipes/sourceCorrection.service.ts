/**
 * `SourceCorrectionService` — the staff correction of a confirmed source answer (ADR-0099, plan everyAnswerSourceLock KTD-6).
 *
 * @pattern Command — one correction is one transaction that commits or rolls back whole
 * @pattern Specification — `evaluateSourceCorrectionScope` decides; this class only orders the work and does the I/O
 *
 * ## The order is the contract
 *
 *  1. `forbidden` is decided from the caller's grants BEFORE any database work: a caller without the grant costs one pure call.
 *  2. The owner's private-slot lock (ADR-0073), then the recipe row `FOR UPDATE`. The policy then runs on the LOCKED row, so a
 *     cook's write that raced the correction is seen, and two corrections of one recipe are serialised.
 *  3. On `apply`, in the same transaction: rewrite the source (private; held when the policy says), append the evidence (a web
 *     link, a book or a paid site only), append the correction record, hold the owner's clones.
 *  4. The log line is written AFTER the commit, so a rolled-back correction is never counted as one.
 *
 * ⛔ No log line carries an answer, a link, a citation, a reason or an owner id: the lines are kept 15 months and not scrubbed.
 */
import { Inject, Injectable } from '@nestjs/common';

import type { Principal } from '../auth/principal.js';
import { RecipeSourceEvidenceDal } from './dal/recipeSourceEvidence.dal.js';
import type { RecipesDal } from './dal/recipes.dal.js';
import { SourceCorrectionsDal } from './dal/sourceCorrections.dal.js';
import { evaluateSourceCorrectionScope, type SourceCorrectionVerdict } from './domain/sourceCorrectionScopePolicy.js';
import { evidenceListOf } from './domain/sourceEvidence.js';
import { provenanceNotPermitted, recipeNotFound, sourceCorrectionInvalidTarget } from './recipe.error.js';
import { SOURCE_CORRECT_SCOPE, type SourceCorrectionRequest, type SourceCorrectionResponse } from './recipes.schema.js';
import { RECIPES_DAL } from './recipes.tokens.js';
import { recordSourceCorrected, recordSourceCorrectionRefused } from './sourceEvents.js';

/** What the transaction decided, handed out so the log line is written after the commit. */
type Outcome = SourceCorrectionVerdict;

@Injectable()
export class SourceCorrectionService {
    public constructor(
        @Inject(RECIPES_DAL) private readonly dal: Pick<RecipesDal, 'transaction' | 'lockAndCountPrivateSlots'>,
        // `Pick` types emit `Object` as metadata, so each class token is named.
        @Inject(SourceCorrectionsDal)
        private readonly corrections: Pick<
            SourceCorrectionsDal,
            'lockRecipe' | 'rewriteSource' | 'recordCorrection' | 'holdOwnersClones'
        >,
        @Inject(RecipeSourceEvidenceDal) private readonly evidence: Pick<RecipeSourceEvidenceDal, 'insert'>,
    ) {}

    /**
     * Correct a recipe's source answer.
     *
     * @param principal - The staff caller (the verified principal; its grants decide `forbidden`).
     * @param recipeId - The recipe.
     * @param request - The owner staff confirmed, the answer, the ground and the reason.
     * @returns `applied` when the answer changed, `unchanged` when the recipe already held it.
     * @throws {HttpException} `403 FORBIDDEN` without the grant; `404` for a missing recipe or another owner's (one answer);
     *   `400 VALIDATION_FAILED` for a recipe with no answer to correct.
     * @sideEffect Writes in one transaction; logs one EMF line.
     */
    public async correct(
        principal: Principal,
        recipeId: string,
        request: SourceCorrectionRequest,
    ): Promise<SourceCorrectionResponse> {
        const callerScopes = [...principal.scopes, ...principal.permissions];
        const { ownerAccountId, answer } = request;

        const early = evaluateSourceCorrectionScope({ callerScopes, recipe: undefined, ownerAccountId, answer });

        if (early.kind === 'forbidden') {
            return this.refuse(principal, 'forbidden');
        }

        const outcome = await this.dal.transaction(async (tx): Promise<Outcome> => {
            await this.dal.lockAndCountPrivateSlots(tx, ownerAccountId);

            const recipe = await this.corrections.lockRecipe(tx, recipeId);
            const verdict = evaluateSourceCorrectionScope({ callerScopes, recipe, ownerAccountId, answer });

            if (verdict.kind !== 'apply' || recipe === undefined) {
                return verdict;
            }

            await this.corrections.rewriteSource(tx, {
                recipeId,
                provenance: verdict.provenance,
                hold: verdict.hold,
            });

            for (const row of evidenceListOf(verdict.provenance, 'editor')) {
                await this.evidence.insert(tx, { ...row, recipeId, capture: 'staffCorrection' });
            }

            await this.corrections.recordCorrection(tx, {
                recipeId,
                actorAccountId: principal.userId,
                before: recipe,
                after: verdict.provenance,
                ground: request.ground,
                reason: request.reason,
            });
            await this.corrections.holdOwnersClones(tx, recipeId, recipe.ownerId);

            return verdict;
        });

        switch (outcome.kind) {
            case 'apply':
                recordSourceCorrected({ ground: request.ground, oldKind: outcome.from, newKind: outcome.to });

                return { result: 'applied' };
            case 'unchanged':
                return { result: 'unchanged' };
            case 'forbidden':
                return this.refuse(principal, 'forbidden');
            case 'notFound':
                return this.refuse(principal, 'notFound', recipeId);
            case 'invalidTarget':
                return this.refuse(principal, 'invalidTarget');
        }
    }

    /** Log the refusal and throw its answer. */
    private refuse(
        principal: Principal,
        refusal: 'forbidden' | 'notFound' | 'invalidTarget',
        recipeId?: string,
    ): never {
        recordSourceCorrectionRefused({ refusal, callerId: principal.userId });

        switch (refusal) {
            case 'forbidden':
                throw provenanceNotPermitted('Correcting a source answer requires the staff grant.', {
                    requiredScope: SOURCE_CORRECT_SCOPE,
                });
            case 'notFound':
                throw recipeNotFound(recipeId ?? '');
            case 'invalidTarget':
                throw sourceCorrectionInvalidTarget();
        }
    }
}
