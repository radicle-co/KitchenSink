/**
 * `SourceCorrectionService` — the staff correction of a confirmed source answer (ADR-0100, plan everyAnswerSourceLock KTD-6).
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
import { SourceHoldClearsDal } from './dal/sourceHoldClears.dal.js';
import {
    evaluateSourceCorrectionPreview,
    evaluateSourceCorrectionScope,
    type SourceAnswerKind,
    type SourceCorrectionVerdict,
} from './domain/sourceCorrectionScopePolicy.js';
import { evidenceListOf } from './domain/sourceEvidence.js';
import { provenanceNotPermitted, recipeNotFound, sourceCorrectionInvalidTarget } from './recipe.error.js';
import {
    SOURCE_CORRECT_SCOPE,
    type SourceCorrectionPreview,
    type SourceCorrectionRequest,
    type SourceCorrectionResponse,
} from './recipes.schema.js';
import { RECIPES_DAL } from './recipes.tokens.js';
import { recordSourceCorrected, recordSourceCorrectionRefused } from './sourceEvents.js';

/** What a preview cites for an answer: the link, the cook's citation, or nothing for "I wrote this" and "from another person". Pure. */
function citationOf(
    answer: SourceAnswerKind,
    recipe: { sourceUrl: string | null; sourceAttribution: string | null },
): string | null {
    switch (answer) {
        case 'webPage':
            return recipe.sourceUrl;
        case 'book':
        case 'paidSite':
            return recipe.sourceAttribution;
        case 'own':
        case 'person':
            return null;
    }
}

@Injectable()
export class SourceCorrectionService {
    public constructor(
        @Inject(RECIPES_DAL) private readonly dal: Pick<RecipesDal, 'transaction' | 'lockAndCountPrivateSlots'>,
        // `Pick` types emit `Object` as metadata, so each class token is named.
        @Inject(SourceCorrectionsDal)
        private readonly corrections: Pick<
            SourceCorrectionsDal,
            'lockRecipe' | 'rewriteSource' | 'recordCorrection' | 'holdOwnersClones' | 'readPreview'
        >,
        @Inject(RecipeSourceEvidenceDal) private readonly evidence: Pick<RecipeSourceEvidenceDal, 'insert'>,
        @Inject(SourceHoldClearsDal) private readonly holdClears: Pick<SourceHoldClearsDal, 'readCorrectionChain'>,
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

        const outcome = await this.dal.transaction(async (tx): Promise<SourceCorrectionVerdict> => {
            await this.dal.lockAndCountPrivateSlots(tx, ownerAccountId);

            const recipe = await this.corrections.lockRecipe(tx, recipeId);
            const verdict = evaluateSourceCorrectionScope({ callerScopes, recipe, ownerAccountId, answer });

            if (verdict.kind === 'apply' && recipe !== undefined) {
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
            }

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

    /**
     * What staff see before they apply a correction: the recipe's title, owner, answer and visibility (ADR-0100 runbook).
     *
     * Read-only and unlocked: it is display, and `correct` re-decides on the locked row. The same order as `correct`: the grant
     * first, with no read; then ONE answer for a missing recipe and a wrong owner. Nothing is logged on success, and no refusal
     * line carries a title, owner, citation or reason.
     *
     * @param principal - The staff caller.
     * @param recipeId - The recipe.
     * @param ownerAccountId - The owner staff confirmed.
     * @returns The preview.
     * @throws {HttpException} `403 FORBIDDEN` without the grant; `404` for a missing recipe or another owner's.
     */
    public async preview(
        principal: Principal,
        recipeId: string,
        ownerAccountId: string,
    ): Promise<SourceCorrectionPreview> {
        const callerScopes = [...principal.scopes, ...principal.permissions];

        if (evaluateSourceCorrectionPreview({ callerScopes, recipe: undefined, ownerAccountId }).kind === 'forbidden') {
            return this.refuse(principal, 'forbidden');
        }

        const recipe = await this.corrections.readPreview(recipeId);
        const verdict = evaluateSourceCorrectionPreview({ callerScopes, recipe, ownerAccountId });

        if (verdict.kind !== 'found' || recipe === undefined) {
            return this.refuse(principal, verdict.kind === 'forbidden' ? 'forbidden' : 'notFound', recipeId);
        }

        // Display only: the clear re-reads the chain under the lock.
        const [latest] = await this.holdClears.readCorrectionChain(recipeId);

        return {
            title: recipe.title,
            ownerAccountId: recipe.ownerId,
            visibility: recipe.visibility,
            answer:
                verdict.answer === undefined
                    ? null
                    : { kind: verdict.answer, citation: citationOf(verdict.answer, recipe) },
            sourceCorrected: recipe.sourceCorrectionHold,
            latestCorrectionId: latest?.id ?? null,
        };
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
