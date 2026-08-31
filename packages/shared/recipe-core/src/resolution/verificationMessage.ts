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
 * A trimmed, non-empty string bounded in Unicode CODE POINTS.
 *
 * ⛔ NOT `z.string().max(n)`, and the difference is a live defect rather than pedantry. Zod's `.max()`
 * counts UTF-16 code units, while `verificationGatePolicy`'s cap counts CODE POINTS — and its docstring
 * explains why: "an astral character is one thing a tokenizer sees and two `String.length` units". With the
 * two files measuring the same bound in different units, the PRODUCER's policy says `verify` for a line the
 * CONSUMER's schema then refuses. Measured in this tree: 120 pizza emoji plus 250 ASCII characters is 370
 * code points (the policy admits it) and 490 UTF-16 units (`.max(400)` rejects it). The message is built,
 * sent, redelivered 20 times under `maxReceiveCount`, and lands in a three-day DLQ carrying a cook's recipe
 * text — while the API reports success and the line is never verified.
 *
 * It does not take a pathological input: 250 ASCII characters and 80 emoji clears the policy and fails the
 * schema. Counting code points at BOTH ends is what makes the two bounds the same bound.
 *
 * @param max - The bound, in code points.
 * @returns The schema. Pure.
 */
function boundedText(max: number): z.ZodType<string> {
    return z
        .string()
        .trim()
        .min(1)
        .refine((value) => [...value].length <= max, { error: `must be at most ${String(max)} characters` });
}

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
export const scoredCandidateSchema = z.object({
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
    /**
     * ⛔ `ownerId` STOOD HERE AND WAS REMOVED — owner ruling 2026-08-25, ADR-0027. Do not re-add it.
     *
     * It existed for exactly one purpose, stated in its own docstring: to carry the recipe owner from this
     * producer to the worker so that a phrase the worker REMEMBERS in `ingredient_resolution_memos` could
     * later be erased (migration 0026). The owner ruled that an ingredient phrase is not private data;
     * migration 0033 dropped the memo's person column and the erasure sweep with it, which left this field
     * with no consumer at all — `verifyLine.ts` was the only reader, and it fed nothing else.
     *
     * ⚠️ Removing it is safe in BOTH deploy directions, which is why it goes now rather than "after one
     * release": this is a `z.object`, so a message from the previous producer still carrying `ownerId` has
     * that key STRIPPED rather than rejected, and the field was already `.optional()`, so a new producer
     * omitting it parses against an older worker. It also strictly REDUCES what a DLQ message holds — see
     * the note above about weighing every field against that question.
     */
    /** The line the cook's source said. UNTRUSTED, and the reason for every bound above. */
    sourceLine: boundedText(MAX_VERIFICATION_SOURCE_LINE_LENGTH),
    /**
     * The ingredient PHRASE the parse lifted out of {@link sourceLine} — `all-purpose flour` from
     * `2 cups all-purpose flour` (owner ruling 2026-08-31, U15 report "Owner rulings" §3).
     *
     * ⛔ THE MEMO-GRAIN FIELD. The memo tier's read side queries `normalizedIngredientKey(name)` — the
     * phrase a picker or importer asks with — while the memo write keyed on the whole source line, so a
     * memo written from `one quart of cold water` could never serve a query for `cold water`. The worker
     * keys `ingredient_resolution_memos` on THIS field; when it is absent (an older producer, or a line
     * whose phrase is unknown) the worker writes NO memo rather than one at a dead grain.
     *
     * ⚠️ IT IS A KEY, NOT EVIDENCE, and the worker must not trust it blindly: the model's agreement is
     * about `sourceLine` ↔ `candidateFoodName`, so a phrase not contained in the judged line would let a
     * producer bind an arbitrary key to a legitimately-verified food in a memo table shared ACROSS USERS.
     * The worker therefore refuses to memoize a phrase whose tokens do not appear in the source line.
     *
     * Optional through at least one release for the same reason `statedMeasure` is: the queue holds
     * messages from the producer that predates the field.
     */
    ingredientPhrase: boundedText(MAX_VERIFICATION_SOURCE_LINE_LENGTH).optional(),
    /** The opaque food-service id the cascade resolved to. */
    foodId: z.string().min(1).max(64),
    /** That food's catalog name — what the model is asked to judge identity against. */
    candidateFoodName: boundedText(MAX_VERIFICATION_FOOD_NAME_LENGTH),
    /**
     * Our parsed amount, or the low end of a range. `null` when the parser found none.
     *
     * ⛔ Nullable, not optional-defaulting-to-zero: `null` is "the parser found nothing" and `0` is a value it
     * found. The verdict key depends on telling them apart, and so does the question the model is asked.
     */
    quantityLow: z.number().finite().nullable(),
    /** The high end of a range, or `null` for an exact quantity. */
    quantityHigh: z.number().finite().nullable(),
    /**
     * Our parsed unit, or `null` when the parser found none.
     *
     * ⚠️ THE BOUND IS TIGHTER THAN THE WIRE'S AND TIGHTER THAN THE COLUMN'S, deliberately.
     * `recipeIngredientUnitSchema` has NO maximum and `recipe_ingredients.unit` is `text`, so a client can
     * store a unit this schema would refuse. That asymmetry is correct — a 65-character unit reaches the
     * PROMPT, and this contract's every bound exists to keep a worst-case reservation honest (ADR-0024 §2) —
     * but it means the producer can hold a line it cannot ask about. That is why the SQS adapter parses each
     * message against this schema before sending: the line goes unverified (today's behaviour) with a log,
     * instead of becoming DLQ poison carrying recipe text.
     */
    unit: z.string().max(64).nullable(),
    /**
     * What the SOURCE printed, when the three fields above are a RESTATEMENT of it (plan U7 R35 / U11).
     *
     * ⛔ THE FIELD THAT STOPS THE GATE MANUFACTURING A FALSE DISAGREE. The importer restates a historical
     * measure at parse time — `one gill of milk` is persisted as `0.5 cup`, because the USDA
     * household-portion table has never heard of a gill — and until this field existed the worker was shown
     * `sourceLine: 'one gill of milk'` beside `quantityLow: 0.5, unit: 'cup'` and asked whether they agree.
     * They do not, and the model is RIGHT to say so about a line we parsed correctly. U11 names the
     * false-disagree rate as the number that triggers a rethink, because a wrong AGREE passes data that would
     * have shipped anyway while a wrong DISAGREE withholds nutrition from a correct line.
     *
     * ⛔ A NESTED OBJECT, not three flat `stated*` fields, and that is the same argument
     * `recipeSourceInputSchema` makes for its union: three coordinated optionals can spell HALF a stated
     * measure — an amount that cannot say what unit it was printed in — and a half claim is one the worker
     * would go on to ask about. Nested, absence has exactly one spelling.
     *
     * ⛔ Neither `quantityLow` nor `unit` is nullable, unlike their flat siblings above, and the asymmetry is
     * the point rather than an oversight: `convertHistoricalUnit` refuses an `absent` quantity outright and
     * requires a unit to convert FROM, so "restated from no amount" and "restated from no unit" are states no
     * producer can reach. The flat fields are nullable because a PARSE genuinely can find neither.
     *
     * ⚠️ OPTIONAL, and it must stay optional through at least one release — the same reason `ownerId`
     * carries. The queue holds messages enqueued by the producer that predates this field, and making it
     * required turns every one of them into DLQ poison the moment the new worker deploys. A message arriving
     * without it is judged against the persisted pair, which is exactly the behaviour it had before.
     *
     * ⚠️ It is ALSO part of the verdict's KEY (`VerifiedLineIdentity.statedMeasure`, bumped to `v2`), not
     * merely prompt decoration — a restated line and an un-restated one can otherwise share a key while being
     * shown different numbers and reaching different verdicts.
     */
    statedMeasure: z
        .object({
            /** The amount the source printed, or the low end of a printed range. */
            quantityLow: z.number().finite(),
            /** The high end of a printed range; `null` when the source printed one value. */
            quantityHigh: z.number().finite().nullable(),
            /**
             * The unit the source printed.
             *
             * Bounded at 64 code points like its flat sibling, and for the same reason: it reaches the PROMPT,
             * and ADR-0024 §2 makes a hard input cap a precondition of an honest spend reservation. The same
             * documented asymmetry applies — `recipe_ingredients.stated_unit` is `text` and the create wire
             * has no maximum, so a longer unit fails the SQS adapter's parse and the line goes unverified with
             * a log, rather than becoming DLQ poison carrying recipe text.
             */
            unit: z.string().min(1).max(64),
        })
        .optional(),
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
    /**
     * Whether this line was SHADOW-SAMPLED (plan U3/U4): its band held authority, and the producer's coin
     * chose to ask identity anyway so the band's measured record keeps accruing. The worker reads it for
     * exactly two things — it treats authority as absent when re-running the gate policy, and it records
     * the resulting observation under source `shadow` rather than `gate`. Absent means an ordinary send.
     */
    shadowSample: z.boolean().optional(),
    /**
     * U11/R20: the shortlist behind this line was AUTHOR-AUGMENTED — the caller's own private food ranked
     * in it, so its margins are facts about one user's catalog. The worker records NO band observation
     * for the verdict; everything else about the verification is unchanged.
     */
    authorAugmented: z.boolean().optional(),
    /**
     * U11/R20: the BOUND food is the caller's own PRIVATE authored one. The worker writes NO resolution
     * memo (a memo row would surface the private food id in every user's memo tier) and NO band
     * observation. The verdict itself still lands — the author's own line is verified like any other.
     */
    privateFood: z.boolean().optional(),
});

/** The verification gate's message contract. */
export type VerifyIngredientLineMessage = z.infer<typeof verifyIngredientLineMessageSchema>;
