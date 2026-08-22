/**
 * `ResolutionMappingsService` — the correction write path (plan U10 / R19, R20).
 *
 * DESIGN PATTERN: **Application Service / Command.** It owns exactly three things, and NO rules:
 *
 *  1. **The Unit of Work.** Reading the facts, deciding, and writing must be one transaction, or two users
 *     correcting the same phrase concurrently both read "nobody else agrees" and a corroboration is silently
 *     lost. `findWriteFacts` takes the row lock; this service is what holds it across the decision.
 *  2. **The PARSE at the boundary.** The caller's raw phrase becomes a `NormalizedIngredientKey` here, once,
 *     and the raw text is persisted beside it — which is what makes a future change to the key derivation a
 *     backfill rather than data loss.
 *  3. **The audit emission**, after the transaction commits, and only for a promotion that actually happened.
 *
 * The scope rules live in `domain/mappingScopePolicy.ts` (pure, exhaustible as a truth table) and the
 * statements live in `resolutionMappings.dal.ts` (where the authorization is a `WHERE` clause rather than a
 * branch). This service sees both and decides neither — that separation is the seam, and it is what makes an
 * unauthorized write impossible to express rather than merely absent.
 *
 * ⚠️ NOTHING CALLS THIS YET, and that is expected at this step. The correction affordance is U14's, and U10
 * cannot publish a route: adding one would mean adding a request schema, which `contract-gen` copies into
 * `@kitchensink/schema-recipe` and which moves the recipe service's `CONTRACT_HASH` — a change U14 owns this
 * cycle. So U10 ships the write path and U14 exposes it. The path is proved end to end at the integration
 * tier instead, by calling this service directly.
 */
import { Injectable } from '@nestjs/common';
import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';

import type { Principal } from '../../auth/principal.js';
import { evaluateMappingWrite } from '../domain/mappingScopePolicy.js';
import { MappingPromotionAudit } from './mappingPromotionAudit.js';
import { ResolutionMappingsDal } from './resolutionMappings.dal.js';

/** One correction, as the caller states it. */
export interface RecordCorrectionInput {
    /** The correcting user, whose SIGNED grants decide how far the correction reaches. */
    readonly principal: Principal;
    /** The ingredient text the user was looking at — raw, exactly as typed or parsed. */
    readonly phrase: string;
    /** The food they say it means. */
    readonly foodId: string;
    /** Which affordance produced the correction (R20). */
    readonly surfacing: string;
}

/** What a correction did. */
export type RecordCorrectionResult =
    | { readonly written: false; readonly reason: string }
    | {
          readonly written: true;
          /** The mapping row created. */
          readonly mappingId: string;
          /** Whether this correction also bound the phrase for everyone, by corroboration. */
          readonly promotedToGlobal: boolean;
      };

@Injectable()
export class ResolutionMappingsService {
    public constructor(
        private readonly dal: ResolutionMappingsDal,
        private readonly audit: MappingPromotionAudit,
    ) {}

    /**
     * Record a user's correction of what an ingredient phrase means.
     *
     * @param input - The correcting principal, the raw phrase, the food, and the surfacing.
     * @returns What was written, or why nothing was. A no-op is NOT an error: re-asserting a mapping already
     *   in force for the caller changes nothing, and minting a churn row for it would inflate the very
     *   corroboration count that decides promotion.
     * @sideEffect Opens a transaction over `ingredient_resolution_mappings`; emits the promotion audit signal.
     */
    public async recordCorrection(input: RecordCorrectionInput): Promise<RecordCorrectionResult> {
        const normalizedKey = normalizedIngredientKey(input.phrase);

        if (normalizedKey === undefined) {
            // Nothing is read and nothing is written. The alternative — keying a row on the empty string —
            // would collide every contentless phrase in the installation onto one mapping.
            return { written: false, reason: 'The corrected phrase carried no visible content.' };
        }

        const authorId = input.principal.userId;
        // `scopes` ∪ `permissions`, mirroring identity's `ScopesGuard` rule that a grant is satisfied by
        // EITHER list. Both come from the token's SIGNED `public_metadata`; a top-level claim is never a grant.
        const grantedScopes = [...input.principal.scopes, ...input.principal.permissions];

        const { result, corroboratingAuthorIds } = await this.dal.runInTransaction(async (tx) => {
            const facts = await this.dal.findWriteFacts(normalizedKey, authorId, input.foodId, tx);
            const decision = evaluateMappingWrite({ correctedFoodId: input.foodId, grantedScopes, ...facts });

            return {
                result: await this.dal.applyWrite(
                    {
                        decision,
                        normalizedKey,
                        sourcePhrase: input.phrase,
                        foodId: input.foodId,
                        authorId,
                        surfacing: input.surfacing,
                    },
                    tx,
                ),
                // Captured inside the transaction, where the facts the decision was made on are still the
                // facts: the audit line must name the authors whose agreement actually produced the binding.
                corroboratingAuthorIds: facts.corroboratorsForSameFood.map((mapping) => mapping.authorId),
            };
        });

        if (!result.written) {
            return { written: false, reason: result.reason };
        }

        if (result.promotion !== undefined) {
            // AFTER the commit, and only for a promotion that actually happened. The loser of a concurrent
            // promotion race reaches here with `promotion: undefined`, and emitting for it would double-count
            // one binding and point a reviewer at a row this request did not create.
            this.audit.recordPromotion({
                mappingId: result.promotion.mappingId,
                corroboratingAuthorIds: [...corroboratingAuthorIds, authorId],
                normalizedKey,
            });
        }

        return { written: true, mappingId: result.mappingId, promotedToGlobal: result.promotion !== undefined };
    }
}
