/**
 * `PromotionsService` — the promotion funnel's orchestration (plan U12; Q5 / D8).
 *
 * DESIGN PATTERN: a thin **Application Service** over the pure policy + the repository:
 * `detectCandidacy` gathers facts → `evaluatePromotionCandidacy` → enqueue; `approve` loads the
 * REVIEWED unit → `electCanonical` → the DAO's atomic phase 1 → the audit signal. No rule lives here
 * that the policy or the database does not own.
 *
 * ## ⛔ Detection NEVER throws
 *
 * It rides the authored write path (`FoodsService.createAuthored`/`updateAuthored`) the way the
 * verification producer rides a recipe save: a queue enhancement must not fail the write it observes.
 * A failed detection is logged and the write succeeds; the next write under the name re-detects.
 *
 * ## The audit signal (U10's promotion precedent)
 *
 * Every approval emits ONE structured line naming the promotion row, the canonical, and the
 * contributing foods — so every publication of user-authored data into the shared catalog is
 * enumerable from the logs. The OPERATOR's identity is in the request trace, deliberately not in the
 * table (the `requeue` precedent).
 */
import { Injectable } from '@nestjs/common';

import { electCanonical, evaluatePromotionCandidacy } from '../domain/promotionPolicy.js';
import type { PromotionsDao, PromotionQueueRow } from '../dao/promotions.dao.js';
import type { WorkerLogger } from '../../worker/workerLogger.js';

/** The approve outcome — a union, so every refusal is a typed answer rather than a thrown 500. */
export type ApproveOutcome =
    | { readonly outcome: 'approved'; readonly canonicalFoodId: string; readonly normalizedName: string }
    | { readonly outcome: 'not_found' }
    | { readonly outcome: 'not_pending' }
    | { readonly outcome: 'not_promotable' };

/** The reject outcome. */
export type RejectOutcome =
    { readonly outcome: 'rejected' } | { readonly outcome: 'not_found' } | { readonly outcome: 'not_pending' };

@Injectable()
export class PromotionsService {
    public constructor(
        private readonly dao: PromotionsDao,
        private readonly logger: WorkerLogger,
        /** Injected clock, so the pure policy's `now` is testable. */
        private readonly now: () => Date = () => new Date(),
    ) {}

    /**
     * Evaluate candidacy for one normalized name and enqueue on trigger.
     *
     * @param normalizedName - The name the just-written authored food holds.
     * @sideEffect Reads the facts; may INSERT a queue row. Never throws.
     */
    public async detectCandidacy(normalizedName: string): Promise<void> {
        try {
            const facts = await this.dao.candidacyFacts(normalizedName);
            const decision = evaluatePromotionCandidacy({
                candidates: facts.candidates,
                now: this.now().toISOString(),
                rejectedFingerprints: facts.rejectedFingerprints,
                nameAlreadyClaimed: facts.nameAlreadyClaimed,
            });

            if (!decision.trigger) {
                return;
            }

            const created = await this.dao.enqueueCandidacy({
                normalizedName,
                candidateFoodIds: decision.contributingFoodIds,
                fingerprint: decision.fingerprint,
            });

            if (created) {
                this.logger.info('promotion candidacy queued', {
                    normalizedName,
                    contributingFoodIds: [...decision.contributingFoodIds],
                });
            }
        } catch (error) {
            this.logger.error('promotion detection failed; the authored write is unaffected', {
                normalizedName,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /** The pending moderation queue, oldest first. @sideEffect Reads the queue. */
    public async pending(): Promise<PromotionQueueRow[]> {
        return this.dao.pending();
    }

    /**
     * Approve one candidacy: elect the canonical over the STORED candidate set (the reviewed unit —
     * never a re-detection the operator did not see), run the atomic phase 1, and emit the audit signal.
     *
     * @param id - The queue row.
     * @returns The typed outcome. @sideEffect Reads the row + election facts; one phase-1 transaction.
     */
    public async approve(id: string): Promise<ApproveOutcome> {
        const row = await this.dao.findById(id);

        if (row === undefined) {
            return { outcome: 'not_found' };
        }

        if (row.status !== 'pending') {
            return { outcome: 'not_pending' };
        }

        const survivors = await this.dao.electionFacts(row.candidateFoodIds);

        if (survivors.length === 0) {
            // Every contributing food was deleted (or already changed visibility) since the trigger.
            // There is nothing left to publish; the row stays pending for the operator to reject.
            return { outcome: 'not_promotable' };
        }

        const canonicalFoodId = electCanonical(survivors);
        const committed = await this.dao.approve(id, canonicalFoodId);

        if (!committed) {
            return { outcome: 'not_pending' };
        }

        // AFTER the commit, and only for a promotion that happened — the mapping-promotion audit's rule.
        this.logger.info('promotion approved', {
            promotionId: row.id,
            normalizedName: row.normalizedName,
            canonicalFoodId,
            contributingFoodIds: [...row.candidateFoodIds],
        });

        return { outcome: 'approved', canonicalFoodId, normalizedName: row.normalizedName };
    }

    /**
     * Reject one candidacy. Its fingerprint bars identical resubmission (0015).
     *
     * @param id - The queue row.
     * @returns The typed outcome. @sideEffect One UPDATE.
     */
    public async reject(id: string): Promise<RejectOutcome> {
        const row = await this.dao.findById(id);

        if (row === undefined) {
            return { outcome: 'not_found' };
        }

        const rejected = await this.dao.reject(id);

        if (!rejected) {
            return { outcome: 'not_pending' };
        }

        this.logger.info('promotion rejected', { promotionId: id, normalizedName: row.normalizedName });

        return { outcome: 'rejected' };
    }
}
