/**
 * WHICH LINES THE VERIFICATION GATE IS ASKED ABOUT (plan U11 / ADR-0024 layer 0) — the pure half of the
 * producer.
 *
 * DESIGN PATTERN: **Specification / Policy module**, the sibling of `provenancePolicy.ts` and
 * `sourceLineCarryForward.ts`, and the pure `decide` of the decide/evaluate split this repository already
 * uses in `deploy-gate.sh` and in `evaluateProvenance` vs `RecipesService.create`. It answers ONE question —
 * "for this saved recipe, which lines does the model need to see?" — from its inputs alone: no database, no
 * queue, no clock (`requestedAt` is injected for exactly that reason).
 *
 * ## ⛔ WHY THE PRODUCER LIVES ON THE RECIPE WRITE PATH AND NOT IN THE CASCADE
 *
 * The obvious home looks like a fourth `ResolutionTier`, and both `resolutionCascade.ts` and plan U11 point
 * there. It cannot work, for a reason that is about the gate rather than about wiring. KTD-3 is titled
 * "the verification gate, NOT a residual fallback": "a tier-4-as-residual design never sees a confidently
 * wrong answer, and every one of the ~900 bad `food_id`s was confidently wrong — so the model verifies what
 * is about to be PUBLISHED." A cascade tier is consulted precisely when tiers 1–3 have all PASSED, i.e. when
 * there is no resolution to verify, no `foodId`, and no identity evidence. The message contract says the same
 * thing structurally: `foodId` is `min(1)` and `evidenceKind` is closed over the three identity-establishing
 * tiers, with no member for "nothing resolved".
 *
 * `IngredientsService.addByName` is the next candidate and is also wrong: it is per-PHRASE, and five of the
 * message's nine fields — `recipeId`, `sourceLine`, `quantityLow`, `quantityHigh`, `unit` — do not exist
 * there. They exist in exactly one place, which is where this module is called from: `RecipesService.create`
 * and `RecipesService.update`, after the ingredient rows are persisted.
 *
 * `0024_ingredient_source_line.sql` says the same thing from the data side: it added `source_line` to
 * `recipe_ingredients` — the RECIPE junction — and its header opens "⛔ THIS COLUMN IS WHY U11'S VERIFICATION
 * GATE SHIPPED INERT".
 *
 * ## ⛔ EVERY LINE VERIFIES BOTH ASPECTS, AND THAT IS NOT A PLACEHOLDER
 *
 * The evidence declared is `unattributed` (see the policy's own member docstring). Nothing persists which
 * cascade tier resolved a catalog row — `resolveThroughCascade` keeps only the `foodId` — so by the time a
 * line is saved against a recipe, the provenance is genuinely unrecoverable rather than merely unread. That
 * evidence opens no skip door, so `decideVerification` asks about identity AND quantity. This is KTD-3's own
 * default ("everything else verifies") and the safe direction: over-verifying costs money at ~370x headroom,
 * under-verifying publishes nutrition nothing checked. It is also free against the plan's cost basis, which
 * is stated "under KTD-3's verify-everything policy".
 *
 * ## ⛔ THE ALREADY-REQUESTED FILTER IS A SPEND CONTROL, NOT A TIDINESS ONE
 *
 * `RecipeIngredientsDal.replaceForRecipe` deletes every ingredient row of a recipe and re-inserts the whole
 * set on EVERY save. Without this filter, editing one word of a title re-enqueues — and re-PAYS for — every
 * line in the recipe, which is the exact failure `verificationKey.ts` says content-keying removes. Content
 * keying made the verdict WRITE idempotent; nothing made the CALL idempotent, and this is that.
 *
 * The comparison defers to {@link verificationKeyPreimage} rather than comparing fields locally, because that
 * function is the ONE authoritative answer to "what is this judgement about" — it is what the verdict table
 * is keyed on. Two implementations of that rule would drift, and the drift would be invisible: it would show
 * up only as a bill.
 */
import type { IngredientQuantity } from '@kitchensink/recipe-core';
import {
    decideVerification,
    unattributedEvidence,
    type VerificationThresholds,
} from '@kitchensink/recipe-core/resolution/verification-gate-policy';
import { verificationKeyPreimage } from '@kitchensink/recipe-core/resolution/verification-key';
import type { VerifyIngredientLineMessage } from '@kitchensink/recipe-core/resolution/verification-message';

/**
 * One persisted recipe ingredient line, adapted for the gate.
 *
 * Deliberately NOT `ResolvedIngredientLine` or `RecipeIngredientRow`: those are persistence shapes carrying
 * sort order, display overrides and per-line nutrition overrides that the gate must never see. This is the
 * projection of a line onto the question "is our reading of this source text right?", and nothing else.
 */
export interface VerifiableLine {
    /**
     * The raw line the cook's SOURCE stated, or `undefined` when the line was AUTHORED.
     *
     * ⛔ `undefined` is a statement, not missing data: there is no source for our parse to disagree with, so
     * there is nothing to ask. `decideVerification` reads it as `skip: 'no-source-text'`.
     */
    readonly sourceLine: string | undefined;
    /**
     * The opaque food-service id, or `undefined` for a user-entered ingredient.
     *
     * A user-entered ingredient carries its own nutrition (FR-007a) and references no catalog row, so there
     * is no identity for the model to check and no `candidateFoodName` that would mean anything.
     */
    readonly foodId: string | undefined;
    /** The catalog's name for that food — what the model is asked to judge identity against. */
    readonly candidateFoodName: string;
    /** What the line states: one value, two bounds, or nothing (U8/KTD-6). */
    readonly quantity: IngredientQuantity;
    /** The parsed unit. `''` is the persistence layer's "none" — projected to `null` on the wire. */
    readonly unit: string;
}

/** Everything the plan needs. Total: every input produces a list, and nothing here throws. */
export interface VerificationRequestInput {
    /** The recipe the lines belong to. Correlation only — a verdict is keyed on content, not on this. */
    readonly recipeId: string;
    /** The lines as they are now persisted, in the author's order. */
    readonly lines: readonly VerifiableLine[];
    /**
     * The lines a request was already made for — on an UPDATE, the recipe's previously stored lines.
     *
     * Empty on a create. It is a list of LINES rather than of keys because the caller holds rows, not
     * digests, and because the identity of a judgement is derived here in exactly one place.
     */
    readonly alreadyRequested: readonly VerifiableLine[];
    /** The gate's bands, injected — R17 makes them measured, so calibration is a value change. */
    readonly thresholds: VerificationThresholds;
    /** ISO-8601 instant of this request. Injected so this module has no clock. */
    readonly requestedAt: string;
}

/** The quantity as the wire contract states it: a low bound, and a high bound only for a real range. */
interface QuantityBounds {
    readonly quantityLow: number | null;
    readonly quantityHigh: number | null;
}

/**
 * Project the quantity value object onto the two nullable numbers the contract carries.
 *
 * ⛔ An EXACT quantity reports `quantityHigh: null`, NOT a repeat of its value — that is what the contract
 * means by "the high end of a range, or `null` for an exact quantity", and `verificationKey` distinguishes
 * the two, so a repeat would both re-partition the verdict table and ask the model about a range the line
 * never stated. (This is why recipe-core's `quantityUpperBound` is deliberately NOT used here: it answers a
 * different question — "the largest amount the line admits" — for which an exact quantity's own value is the
 * right answer, and the wrong one for this contract.)
 *
 * @param quantity - The line's stated amount.
 * @returns The two bounds. Pure.
 */
function boundsOf(quantity: IngredientQuantity): QuantityBounds {
    switch (quantity.kind) {
        case 'exact':
            return { quantityLow: quantity.value, quantityHigh: null };
        case 'range':
            return { quantityLow: quantity.low, quantityHigh: quantity.high };
        case 'absent':
            // ⛔ Never zero (R40). "Butter the size of an egg" states no number, not none of something.
            return { quantityLow: null, quantityHigh: null };
    }
}

/**
 * The unit as the wire contract states it.
 *
 * @param unit - The persisted unit, where `''` means the parser found none.
 * @returns The unit, or `null`. Pure.
 */
function unitOf(unit: string): string | null {
    return unit.trim() === '' ? null : unit;
}

/**
 * The canonical identity of the judgement this line would ask for, or `undefined` when it would ask for none.
 *
 * ⛔ Delegates to {@link verificationKeyPreimage} — the same serialization the verdict table is keyed on —
 * rather than comparing fields here. Two answers to "what is this judgement about" would drift, and the drift
 * would surface only as a bill.
 *
 * @param line - The line.
 * @returns The preimage, or `undefined` for a line that carries no judgement (authored, or user-entered).
 */
function judgementIdentity(line: VerifiableLine): string | undefined {
    if (line.sourceLine === undefined || line.foodId === undefined) {
        return undefined;
    }

    const bounds = boundsOf(line.quantity);

    return verificationKeyPreimage({
        sourceLine: line.sourceLine,
        foodId: line.foodId,
        quantityLow: bounds.quantityLow,
        quantityHigh: bounds.quantityHigh,
        unit: unitOf(line.unit),
    });
}

/**
 * Decide which of a saved recipe's lines the verification gate is asked about, and build those messages.
 *
 * ⛔ TOTAL AND NON-THROWING. It is called after the recipe is already persisted, so a throw here would fail a
 * save that had already succeeded. Every line that cannot be asked about is simply absent from the result.
 *
 * @param input - The recipe, its lines, what was already asked, the bands and the instant.
 * @returns The messages to enqueue, in the author's line order, deduplicated by judgement. Pure.
 */
export function buildVerificationRequests(input: VerificationRequestInput): readonly VerifyIngredientLineMessage[] {
    const seen = new Set<string>();

    for (const previous of input.alreadyRequested) {
        const identity = judgementIdentity(previous);

        if (identity !== undefined) {
            seen.add(identity);
        }
    }

    const requests: VerifyIngredientLineMessage[] = [];

    for (const line of input.lines) {
        const { sourceLine, foodId } = line;

        // Two lines the gate structurally cannot be asked about. An AUTHORED line has no source for our parse
        // to disagree with; a USER-ENTERED ingredient has no catalog identity, and a message with an empty
        // `foodId` could not satisfy the consumer's schema — emitting one would manufacture DLQ poison.
        // Destructured so the narrowing is the guard rather than a later assertion.
        if (sourceLine === undefined || foodId === undefined) {
            continue;
        }

        // ⛔ ADR-0024 layer 0. The pure policy decides whether there is anything to ask BEFORE anything is
        // sent — `skip` for a blank line, `reject` for an over-cap one (which is never truncated).
        const decision = decideVerification({
            sourceLine,
            evidence: unattributedEvidence(),
            thresholds: input.thresholds,
        });

        if (decision.kind !== 'verify') {
            continue;
        }

        const identity = judgementIdentity(line);

        if (identity === undefined || seen.has(identity)) {
            continue;
        }

        seen.add(identity);

        const bounds = boundsOf(line.quantity);

        requests.push({
            recipeId: input.recipeId,
            sourceLine,
            foodId,
            candidateFoodName: line.candidateFoodName,
            quantityLow: bounds.quantityLow,
            quantityHigh: bounds.quantityHigh,
            unit: unitOf(line.unit),
            // ⛔ The producer knows of no tier, and must not guess one: `curated-exact` would suppress the
            // identity check. See the module docstring.
            evidenceKind: 'unattributed',
            // No lexical tier has shipped, and this path never ranked anything even when one does — the
            // shortlist belongs to whoever ranked, which is not this caller.
            shortlist: [],
            requestedAt: input.requestedAt,
        });
    }

    return requests;
}
