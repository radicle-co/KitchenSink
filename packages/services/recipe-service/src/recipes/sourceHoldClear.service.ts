/**
 * `SourceHoldClearService`: the two ways back from a correction hold (ADR-0106, plan pr5HoldClear KTD-5, KTD-7).
 *
 * @pattern Command — a staff clear is one transaction that commits or rolls back whole
 * @pattern Specification — `holdClearPolicy` decides; this class only orders the work and does the I/O
 *
 * ## The order is the contract (the staff clear)
 *
 *  1. `forbidden` is decided from the caller's grants BEFORE any database work.
 *  2. The owner's private-slot advisory lock (the correction route's lock, so a correction and a clear of one owner serialise),
 *     then the recipe row `FOR UPDATE`, then the chain, then the owner's descendants in ascending id. The release set is derived
 *     only AFTER those locks, in a new statement.
 *  3. The record is written BEFORE the hold is released: the database ratchet accepts a clear only with a record in the same
 *     transaction.
 *  4. The metric line is written AFTER the commit, valued at the holds cleared, so a rolled-back clear is never counted.
 *
 * ## The earned clear
 *
 * `clearByEarnedRewrite(tx, recipeId)` is service-internal: no controller or request field reaches it (a repoGuards test holds
 * that). Its caller is the cook's rewrite, inside `RecipesService.update`'s transaction (P8h). Caller contract: it (a) takes the
 * caller's transaction and opens none; (b) takes NO slot lock and walks no clones, because an earned clear moves one recipe and
 * no visibility, and a slot lock after update's row lock would invert `set-visibility`'s slot-then-row order; (c) takes its own
 * `FOR UPDATE` on the recipe row (a no-op when the caller holds it) and answers `{ cleared: true }` or `{ cleared: false, reason }`
 * with a CLOSED reason, never silent.
 *
 * ⛔ No log line carries a recipe id, an owner id or a reason.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { HoldClearConflictReason } from '@kitchensink/recipe-core';

import type { Principal } from '../auth/principal.js';
import { postgresErrorOf } from '../database/postgresError.js';
import type { RecipeTx } from '../database/unitOfWork.js';
import type { RecipesDal } from './dal/recipes.dal.js';
import { SourceHoldClearsDal, type CorrectionChainRow } from './dal/sourceHoldClears.dal.js';
import {
    holdClearPolicy,
    type ChainAnswer,
    type EarnedHoldClearRefusal,
    type StaffHoldClearRefusal,
} from './domain/holdClearPolicy.js';
import { answerOf, evaluateSourceCorrectionPreview } from './domain/sourceCorrectionScopePolicy.js';
import { holdClearConflict, provenanceNotPermitted, recipeNotFound } from './recipe.error.js';
import { SOURCE_CORRECT_SCOPE, type SourceHoldClearRequest, type SourceHoldClearResponse } from './recipes.schema.js';
import { RECIPES_DAL } from './recipes.tokens.js';
import { recordSourceCorrectionRefused, recordSourceHoldCleared } from './sourceEvents.js';

/** What the earned clear answers: cleared, or why not. */
export type EarnedClearResult =
    { readonly cleared: true } | { readonly cleared: false; readonly reason: EarnedHoldClearRefusal };

/** A row's answer for the policy. A row with no answer is corrupt: refusing it as "third-party" would fail open. */
function chainAnswerOf(row: CorrectionChainRow): ChainAnswer {
    const answer = answerOf({
        sourceType: row.newSourceType,
        sourceKind: row.newSourceKind,
        statementKind: row.newStatementKind,
    });

    if (answer === undefined) {
        throw new Error('A correction row holds no source answer (corrupt record).');
    }

    return { id: row.id, answer };
}

const STAFF_REFUSAL_CODE = {
    notHeld: 'HOLD_NOT_SET',
    correctionNotLatest: 'CORRECTION_NOT_LATEST',
} as const satisfies Record<StaffHoldClearRefusal, HoldClearConflictReason>;

type StaffOutcome =
    | { readonly kind: 'cleared'; readonly released: number }
    | { readonly kind: 'notFound' }
    | { readonly kind: 'refused'; readonly reason: (typeof STAFF_REFUSAL_CODE)[StaffHoldClearRefusal] };

@Injectable()
export class SourceHoldClearService {
    public constructor(
        @Inject(RECIPES_DAL) private readonly dal: Pick<RecipesDal, 'transaction' | 'lockAndCountPrivateSlots'>,
        @Inject(SourceHoldClearsDal) private readonly clears: SourceHoldClearsDal,
    ) {}

    /**
     * Clear a recipe's correction hold as staff, and the owner's clones the same correction held.
     *
     * @param principal - The staff caller.
     * @param recipeId - The recipe.
     * @param request - The owner staff confirmed, the correction they saw, and the reason.
     * @returns How many holds were cleared (the recipe and each released clone).
     * @throws {HttpException} `403` without the grant.
     * @throws {RecipeDomainError} `RECIPE_NOT_FOUND` for a missing recipe or another owner's; `HOLD_CLEAR_CONFLICT` for a recipe
     *   that is not held, a stale correction, or a deadlock.
     * @sideEffect Writes in one transaction; logs one EMF line after the commit.
     */
    public async clearByStaff(
        principal: Principal,
        recipeId: string,
        request: SourceHoldClearRequest,
    ): Promise<SourceHoldClearResponse> {
        const callerScopes = [...principal.scopes, ...principal.permissions];
        const { ownerAccountId } = request;

        if (evaluateSourceCorrectionPreview({ callerScopes, recipe: undefined, ownerAccountId }).kind === 'forbidden') {
            return this.refuse(principal, 'forbidden');
        }

        let outcome: StaffOutcome;

        try {
            outcome = await this.dal.transaction((tx) => this.clearInTransaction(tx, principal, recipeId, request));
        } catch (error) {
            if (postgresErrorOf(error)?.code === '40P01') {
                throw holdClearConflict('LOCK_CONFLICT');
            }

            throw error;
        }

        switch (outcome.kind) {
            case 'cleared':
                recordSourceHoldCleared({ released: outcome.released });

                return { result: 'cleared', released: outcome.released };
            case 'notFound':
                return this.refuse(principal, 'notFound', recipeId);
            case 'refused':
                recordSourceCorrectionRefused({ refusal: outcome.reason, callerId: principal.userId });
                throw holdClearConflict(outcome.reason);
        }
    }

    /**
     * Clear the correction hold of ONE recipe because the cook's rewrite earned it. Service-internal: see the class comment for
     * the caller contract.
     *
     * @param tx - The caller's open transaction. This method opens none.
     * @param recipeId - The recipe the rewrite earned.
     * @returns `{ cleared: true }`, or `{ cleared: false, reason }` and nothing written.
     * @throws {Error} when a correction row holds no answer (corrupt record).
     * @sideEffect Row-locks the recipe; writes one record and clears the hold when allowed.
     */
    public async clearByEarnedRewrite(tx: RecipeTx, recipeId: string): Promise<EarnedClearResult> {
        const facts = await this.clears.lockHoldFacts(tx, recipeId);

        if (facts === undefined) {
            return { cleared: false, reason: 'notHeld' };
        }

        const chain = (await this.clears.readCorrectionChain(recipeId, tx)).map(chainAnswerOf);
        const verdict = holdClearPolicy({ cause: 'earnedRewrite', held: facts.held, chain });

        if (verdict.kind === 'refuse') {
            return { cleared: false, reason: verdict.reason };
        }

        await this.clears.recordClears(tx, {
            recipeIds: [recipeId],
            cause: 'earnedRewrite',
            actorAccountId: null,
            reason: 'earnedRewrite',
        });
        await this.clears.releaseHolds(tx, [recipeId]);

        return { cleared: true };
    }

    /** The staff clear's transaction body. Refusals return a value: nothing is thrown inside the transaction. */
    private async clearInTransaction(
        tx: RecipeTx,
        principal: Principal,
        recipeId: string,
        request: SourceHoldClearRequest,
    ): Promise<StaffOutcome> {
        await this.dal.lockAndCountPrivateSlots(tx, request.ownerAccountId);

        const facts = await this.clears.lockHoldFacts(tx, recipeId);

        if (facts === undefined || facts.ownerId !== request.ownerAccountId) {
            return { kind: 'notFound' };
        }

        const chain = (await this.clears.readCorrectionChain(recipeId, tx)).map(chainAnswerOf);
        const verdict = holdClearPolicy({
            cause: 'staff',
            held: facts.held,
            chain,
            expectedCorrectionId: request.correctionId,
        });

        if (verdict.kind === 'refuse') {
            return { kind: 'refused', reason: STAFF_REFUSAL_CODE[verdict.reason] };
        }

        await this.clears.lockOwnersDescendants(tx, recipeId, facts.ownerId);

        const released = await this.clears.releasableDescendants(tx, recipeId, facts.ownerId);
        const recipeIds = [recipeId, ...released];

        await this.clears.recordClears(tx, {
            recipeIds,
            cause: 'staff',
            actorAccountId: principal.userId,
            reason: request.reason.trim(),
        });
        await this.clears.releaseHolds(tx, recipeIds);

        return { kind: 'cleared', released: recipeIds.length };
    }

    /** Log the refusal and throw its answer. */
    private refuse(principal: Principal, refusal: 'forbidden' | 'notFound', recipeId?: string): never {
        recordSourceCorrectionRefused({ refusal, callerId: principal.userId });

        if (refusal === 'forbidden') {
            throw provenanceNotPermitted('Clearing a source hold requires the staff grant.', {
                requiredScope: SOURCE_CORRECT_SCOPE,
            });
        }

        throw recipeNotFound(recipeId ?? '');
    }
}
