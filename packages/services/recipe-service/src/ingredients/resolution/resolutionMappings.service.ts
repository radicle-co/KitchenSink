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
 * ✅ REACHABLE SINCE U14. This module's earlier note recorded that nothing called it, because U10 could not
 * publish a route without moving `CONTRACT_HASH`. U14 owns that move and publishes
 * `POST /api/v1/ingredients/corrections`, whose controller is now this service's caller. The seam is
 * unchanged: the controller parses and authenticates, this service holds the Unit of Work, the pure policy
 * decides, the DAL writes.
 */
import { Injectable } from '@nestjs/common';
import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';

import type { Principal } from '../../auth/principal.js';
import { evaluateMappingWrite, type MappingScope } from '../domain/mappingScopePolicy.js';
import type { MappingWriteNoOutcome } from './resolutionMappings.dal.js';
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

/**
 * Why a correction produced no mapping row.
 *
 * WIDER than the DAL's {@link MappingWriteNoOutcome} by exactly one member, and the extra one is a
 * DIFFERENT KIND of answer. `already_in_force` and `superseded` are non-events — the knowledge base already
 * says this, so there is nothing to add — whereas `phrase_not_usable` is a bad REQUEST: the caller sent a
 * phrase that reduces to nothing (zero-width characters, or punctuation alone), which passes a `min(1)`
 * length check and is still not a phrase. The controller answers the first two `200` and the third `400`,
 * which is why they are one union here and two different things at the boundary.
 */
export type RecordCorrectionNoOutcome = MappingWriteNoOutcome | 'phrase_not_usable';

/** What a correction did. */
export type RecordCorrectionResult =
    | { readonly written: false; readonly outcome: RecordCorrectionNoOutcome; readonly reason: string }
    | {
          readonly written: true;
          /** The mapping row created. */
          readonly mappingId: string;
          /**
           * HOW FAR the correction reaches — added by U14, because the caller cannot derive it.
           *
           * ⛔ Reach is decided from the caller's SIGNED grants and from what the knowledge base already
           * holds, neither of which the client can see. Without this field a surface can only say "saved",
           * and would say it identically for a correction that bound one person's own recipes and one that
           * bound the phrase for every user of the installation — misreporting the consequence of an
           * authorization-significant act.
           *
           * `global` covers BOTH ways a correction binds everyone: a grant holder's own ruling, and a
           * promotion earned when a second independent author agrees. From the caller's side the two have
           * the same consequence.
           */
          readonly scope: MappingScope;
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
     * ⚠️ THE PHRASE IS NOT CANONICALIZED FIRST, and it does not need to be — a fact worth stating because the
     * opposite looks safer. `addByName` hands the cascade a `CanonicalIngredientName` and the cascade keys on
     * `normalizedIngredientKey` of it; both `canonicalIngredientName` and `normalizedIngredientKey` compose
     * the SAME idempotent `sanitizeFoodName`, the second one lowercasing after it. So
     * `normalizedIngredientKey(canonicalIngredientName(x))` and `normalizedIngredientKey(x)` are the same key
     * for every `x`, and a correction lands under exactly the key a later resolution of that phrase queries.
     * If either derivation ever stops composing `sanitizeFoodName`, that identity breaks silently — which is
     * why both modules pin it with a golden table.
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
            return {
                written: false,
                outcome: 'phrase_not_usable',
                reason: 'The corrected phrase carried no visible content.',
            };
        }

        const userId = input.principal.userId;
        // `scopes` ∪ `permissions`, mirroring identity's `ScopesGuard` rule that a grant is satisfied by
        // EITHER list. Both come from the token's SIGNED `public_metadata`; a top-level claim is never a grant.
        const grantedScopes = [...input.principal.scopes, ...input.principal.permissions];

        const { result, decidedScope, corroboratingAuthorIds } = await this.dal.runInTransaction(async (tx) => {
            const facts = await this.dal.findWriteFacts(normalizedKey, userId, input.foodId, tx);
            const decision = evaluateMappingWrite({ correctedFoodId: input.foodId, grantedScopes, ...facts });

            return {
                // The reach the POLICY decided, captured here rather than re-derived from the result: the
                // result records what rows were written, and `write: 'global'` (a curator's own ruling) is
                // indistinguishable from an ordinary author write in that record.
                decidedScope: decision.write === 'none' ? undefined : decision.scope,
                result: await this.dal.applyWrite(
                    {
                        decision,
                        normalizedKey,
                        sourcePhrase: input.phrase,
                        foodId: input.foodId,
                        userId,
                        surfacing: input.surfacing,
                    },
                    tx,
                ),
                // Captured inside the transaction, where the facts the decision was made on are still the
                // facts: the audit line must name the users whose agreement actually produced the binding.
                // ⚠️ The SIGNAL keeps the name `corroboratingAuthorIds` even though the column is now
                // `user_id` (migration 0033): it is an emitted log-field key, so renaming it would move an
                // operational contract a dashboard or query may already read, for no gain. The concept it
                // names — the AUTHORS of the corroborating author-scoped rows — is the one `scope`/`origin`
                // still spell `author`.
                corroboratingAuthorIds: facts.corroboratorsForSameFood.map((mapping) => mapping.userId),
            };
        });

        if (!result.written) {
            return { written: false, outcome: result.outcome, reason: result.reason };
        }

        if (result.promotion !== undefined) {
            // AFTER the commit, and only for a promotion that actually happened. The loser of a concurrent
            // promotion race reaches here with `promotion: undefined`, and emitting for it would double-count
            // one binding and point a reviewer at a row this request did not create.
            this.audit.recordPromotion({
                mappingId: result.promotion.mappingId,
                corroboratingAuthorIds: [...corroboratingAuthorIds, userId],
                normalizedKey,
            });
        }

        const promotedToGlobal = result.promotion !== undefined;

        return {
            written: true,
            mappingId: result.mappingId,
            // A promotion binds the phrase for everyone even though the row THIS caller wrote is
            // author-scoped, so the reach the caller is told about is the reach that now applies — not the
            // scope column of one row. `decidedScope` cannot be `undefined` on a written result (the policy
            // only omits it for `write: 'none'`), and the fallback states the safer of the two rather than
            // asserting a reach nothing decided.
            scope: promotedToGlobal ? 'global' : (decidedScope ?? 'author'),
            promotedToGlobal,
        };
    }
}
