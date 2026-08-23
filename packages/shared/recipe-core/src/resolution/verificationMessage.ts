/**
 * THE VERIFICATION GATE'S QUEUE CONTRACT (plan U11, ADR-0024) — authored as zod, parsed at both ends.
 *
 * ## ⛔ WHY IT LIVES IN `recipe-core` AND NOT BESIDE THE WORKER THAT CONSUMES IT
 *
 * It shipped in `recipe-workers/src/common/messages.schema.ts`, whose own docstring names the reason it
 * could: `RecipeVersionArchiveMessage` is produced and consumed inside that package, so one definition
 * served both ends. That stopped being true the moment the producer landed. The producer is
 * `recipe-service` — a Fargate service — and `@kitchensink/recipe-workers` is one of its **devDependencies**,
 * present only so `infra/__tests__` can synthesize the workers stack. It is absent from
 * `recipe-service/prod.package.json`, so a runtime import of it resolves in the workspace, typechecks, and
 * throws `ERR_MODULE_NOT_FOUND` the moment the container boots. Adding it to the image instead would ship a
 * bundle of Lambda handlers, `aws-lambda` types and the Bedrock client inside the API image to obtain one
 * zod object.
 *
 * `recipe-core` is already a RUNTIME dependency of both packages and already carries `zod`. It is where the
 * erasure producer's own message type lives (`AccountErasureMessage`), and where `verificationGatePolicy.ts`
 * lives for the identical reason — the policy is run at both ends and must be the same rule at both. So this file is that precedent applied, not a new arrangement.
 *
 * ⛔ Reachable ONLY as `@kitchensink/recipe-core/resolution/verification-message`, never from the barrel:
 * `contract-gen` hashes `src/index.ts`, so one added line there moves the recipe service's `CONTRACT_HASH`
 * for a module with no wire projection.
 *
 * ## `z.object`, so unknown keys are STRIPPED rather than rejected
 *
 * The same property the sibling worker contracts have, for the same reason: a producer deployed ahead of a
 * consumer must be able to add a field without filling a DLQ with poison messages. The safety property is
 * that every field the worker ACTS on is validated — not that the producer is forbidden from saying more.
 */
import { z } from 'zod';

/**
 * An ISO-8601 instant.
 *
 * `z.iso.datetime()` rather than a `Date.parse` refinement, because `Date.parse` accepts a large amount of
 * implementation-defined slop (`'2026'`, `'Aug 12 2026'`) and these values are compared against `timestamptz`
 * columns, where a non-normalized string is a comparison that quietly does the wrong thing rather than an
 * error. Declared here rather than imported from the worker's sibling contracts for the reason in the file
 * docstring: this module must not depend on that package.
 */
const isoInstant = (): z.ZodISODateTime => z.iso.datetime();

/**
 * The largest source line this queue will carry, in characters.
 *
 * ⛔ SOURCED FROM THE SPEND CEILING, not from a column. ADR-0024 §2 makes a hard input cap a PRECONDITION of
 * the reserve-then-settle counter: "worst-case cost is `MAX_INPUT_TOKENS x inRate + maxTokens x outRate`. If
 * prompt length is unbounded, the reservation is a lie and the ceiling does not hold." The queue is the last
 * place the value can be refused before it becomes a worst case, so the bound is applied here as well as in
 * the pure gate policy — the policy's copy decides the LINE's fate (over-cap resolves as unresolved, never
 * truncated), this one refuses a malformed MESSAGE.
 *
 * It equals `PROVISIONAL_VERIFICATION_THRESHOLDS.maxSourceLineChars` today, and sits beside it in this very
 * package. ⚠️ Deliberately NOT imported from it: that value is CALIBRATION, expected to move when the
 * bake-off measures the residual, while this is a TRANSPORT bound that must stay stable for a producer
 * deployed either side of a consumer. Same number, two different reasons to change — precisely the case DRY
 * says not to merge.
 */
export const MAX_VERIFICATION_SOURCE_LINE_LENGTH = 400;

/** The largest catalog name this queue will carry. It reaches the prompt, so it is bounded for the same reason. */
export const MAX_VERIFICATION_FOOD_NAME_LENGTH = 300;

/**
 * The largest shortlist this queue will carry.
 *
 * The lexical tier's own page size is far below this; the bound exists so ONE message cannot become an
 * unbounded prompt, which is the same worst-case argument as the line length.
 */
export const MAX_VERIFICATION_SHORTLIST = 25;

/** One scored candidate as the lexical tier ranked it. Mirrors `ScoredCandidate` in `@kitchensink/recipe-core`. */
const scoredCandidateSchema = z.object({
    foodId: z.string().min(1).max(64),
    /**
     * The tier's own ordinal score.
     *
     * `.finite()` is load-bearing: `NaN >= threshold` is false and `NaN` propagates through the margin
     * subtraction, so an unvalidated score silently turns the margin door into "always verify" — or, with the
     * comparison the other way, into "always skip", which publishes an unchecked resolution.
     */
    score: z.number().finite(),
    energyKcalPer100g: z.number().finite().optional(),
    proteinGPer100g: z.number().finite().optional(),
    fatGPer100g: z.number().finite().optional(),
    carbohydrateGPer100g: z.number().finite().optional(),
});

/**
 * `VerifyIngredientLineMessage` — the verification gate's queue contract (plan U11, ADR-0024).
 *
 * ⛔ IT CARRIES INPUTS, NEVER CONCLUSIONS. There is deliberately no `aspects` field and no `skip` field. The
 * PRODUCER runs the pure `decideVerification` to decide whether to enqueue at all — ADR-0024 layer 0, "the
 * cheapest control in the stack is the message that is never sent" — and the WORKER re-runs the same policy on
 * the parsed message to decide what it actually asks about. Trusting a conclusion off the wire would let a
 * producer bug, an older producer release, or a replayed message skip an identity check silently, and the
 * policy is pure and total so re-running it costs microseconds.
 *
 * ⚠️ THIS MESSAGE CONTAINS A COOK'S RECIPE TEXT. `sourceLine` is user-authored, so a message sitting in the
 * DLQ is a copy of personal data outside every erasure path (the erasure worker deletes rows and S3 objects;
 * it does not purge SQS). The queue is SSE-encrypted and this DLQ's retention is shortened accordingly — see
 * `RecipeWorkersStack`. Recorded here so the next field added is weighed against the same question.
 */
export const verifyIngredientLineMessageSchema = z.object({
    /** The recipe the line belongs to. Correlation only — the verdict is keyed on content, not on this. */
    recipeId: z.uuid(),
    /** The line the cook's source said. UNTRUSTED, and the reason for every bound above. */
    sourceLine: z.string().trim().min(1).max(MAX_VERIFICATION_SOURCE_LINE_LENGTH),
    /** The opaque food-service id the cascade resolved to. */
    foodId: z.string().min(1).max(64),
    /** That food's catalog name — what the model is asked to judge identity against. */
    candidateFoodName: z.string().trim().min(1).max(MAX_VERIFICATION_FOOD_NAME_LENGTH),
    /**
     * Our parsed amount, or the low end of a range. `null` when the parser found none.
     *
     * ⛔ Nullable, not optional-defaulting-to-zero: `null` is "the parser found nothing" and `0` is a value it
     * found. The verdict key depends on telling them apart, and so does the question the model is asked.
     */
    quantityLow: z.number().finite().nullable(),
    /** The high end of a range, or `null` for an exact quantity. */
    quantityHigh: z.number().finite().nullable(),
    /** Our parsed unit, or `null`. */
    unit: z.string().max(64).nullable(),
    /**
     * Which cascade tier established identity — the discriminant of `IdentityEvidence`.
     *
     * A closed enum because it selects which skip doors are open. An unrecognised value would have to fall
     * back to a default, and both defaults are wrong: "verify everything" spends on lines that need not be
     * checked, "skip identity" publishes an unchecked resolution.
     *
     * ⚠️ `unattributed` is what the SHIPPED producer sends, and it is not a placeholder. The recipe write
     * path enqueues from persisted `recipe_ingredients` rows, and nothing persists which cascade tier
     * resolved the catalog row those rows point at — so the provenance is genuinely unrecoverable there.
     * It opens no door, which is KTD-3's own default. ⛔ It must never become a value a CLIENT can declare:
     * `curated-exact` suppresses the identity check, which would be a conclusion wearing an input's clothes
     * — exactly what this contract's "INPUTS, NEVER CONCLUSIONS" rule forbids.
     */
    evidenceKind: z.enum(['curated-exact', 'ranked', 'remembered', 'unattributed']),
    /** The lexical tier's ranked candidates. EMPTY until U5 ships one, which the policy handles with no special case. */
    shortlist: z.array(scoredCandidateSchema).max(MAX_VERIFICATION_SHORTLIST),
    /** ISO 8601 timestamp of when verification was requested (observational). */
    requestedAt: isoInstant(),
});

/** The verification gate's message contract. */
export type VerifyIngredientLineMessage = z.infer<typeof verifyIngredientLineMessageSchema>;
