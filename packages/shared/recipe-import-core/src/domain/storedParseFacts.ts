/**
 * @module storedParseFacts — what a STORED parse holds, and the two directions between it and a
 * {@link ParsedLine} (plan U22, phase 4 / KTD-13, KTD-14).
 *
 * DESIGN PATTERN: **Anti-Corruption Layer** over the two `jsonb` columns that hold a parse —
 * `ingredient_parse_cache.parse` and `ingredient_parse_corrections.corrected_facts` — plus the projection
 * into that shape and the rehydration out of it. Deliberately separate from `parsePipeline.ts`, which owns
 * exactly ONE rule (the order); what a stored row means is a different piece of knowledge.
 *
 * ⚠️ It is named for the SHAPE, not for a store, because BOTH stores hold the same one. The corrections
 * schema already ruled on it, in the same feature and in the same words: `CorrectedParse`'s docstring says
 * it is `ParsedFacts` "and deliberately NOT the wider `ParsedLine`, whose `raw` member is the input
 * byte-identical. Storing `raw` here would put a SECOND copy of the erasable text in a column no sweep
 * touches." This module is that ruling, made executable, and applied to the cache as well.
 *
 * ⚠️ {@link StoredParse.reviewReasons} is read back off a CORRECTION and then IGNORED: `promoteCorrection`
 * hard-codes an empty list and argues why in its own docstring, so "a line a human has looked at wants no
 * further review" keeps ONE authority instead of being restated as a refusal here. Refusing the member for
 * that store would put a second rule beside the first, and the first already decides the outcome.
 *
 * ## ⛔ THE PAYLOAD IS THE FACTS, AND THE COOK'S LINE IS NOT AMONG THEM
 *
 * `ingredient_parse_cache.line_digest`'s own docstring calls itself "the ONLY representation of the cook's
 * line that is stored anywhere in this table", and that sentence is load-bearing: it is the whole of KTD-14's
 * argument for why the table carries no owner column and is absent from the account-erasure sweep. A
 * {@link ParsedLine} carries `raw`, which is that line BYTE-IDENTICAL (HAZ-041). So a row storing a whole
 * `ParsedLine` would put the line itself in the table and quietly retire the erasure argument, with nothing
 * failing.
 *
 * ⚠️ This CONTRADICTS a forward-looking note in `recipe-service`'s
 * `src/database/schema/ingredientParseCache.ts` — "When U16 lands, this alias becomes `ParsedLine`". U16 has
 * landed and the answer is no; that comment was corrected in the same change as this module.
 *
 * ## ⛔ NOTHING DERIVABLE IS STORED — the two fields a row does not need
 *
 * | dropped      | where it comes back from                                                             |
 * | ------------ | ------------------------------------------------------------------------------------ |
 * | `raw`        | the caller, which holds the line it asked about (the same reason both promotion adapters take it as a parameter) |
 * | `provenance` | the row's own `engine` column — a per-engine row has exactly one reader               |
 *
 * ## ⛔ `reviewReasons` IS STORED, BECAUSE IT IS A JUDGEMENT AND NOT A READING
 *
 * A reason is "why this line still wants a human's eye", and the producer is the only thing that knows.
 * `validatedEngine.ts` raises `not_a_food` when a validator DISPUTED a name and `measurement_unverified`
 * when the measurement judge objected through every retry; neither is a function of the measure phrase, so
 * a rehydration that re-read the phrase would serve a line a judge rejected as one nobody questioned.
 *
 * ⛔ And re-reading is not merely incomplete, it FABRICATES: `validatedEngine.ts`'s `unParseable` record
 * blanks the measure and carries `not_a_food` alone, while reading a blank measure yields `no_quantity` —
 * a flag about an amount nobody disputed, on a line whose real verdict had been dropped. So the recorded
 * list is served WHOLE, never merged with a derivation.
 *
 * ⛔ `PARSE_KEY_VERSION` IS BUMPED FOR THIS MEMBER — to `v2`, and the reason lives there. The member is
 * REQUIRED, and the cache is written `ON CONFLICT (parse_key) DO NOTHING`, so without the bump a row of the
 * previous generation is re-read, re-missed and re-discarded on every submission, paying both engines forever.
 *
 * ## ⛔ PARSED, NEVER CAST
 *
 * The column is `jsonb` and the row may outlive the shape that wrote it: `PARSE_KEY_VERSION`'s own docstring
 * describes a superseded generation as "inert and ENUMERABLE" — meaning still THERE — and a shape change
 * that does not move the key version leaves old rows reachable outright. A cast admits every one of them,
 * and the symptom is a field that is silently `undefined` on a value that type-checks. `strictObject` also
 * makes the one row this module must never serve — a payload carrying `raw` — a refusal rather than an
 * extra key nothing reads.
 */
import { z } from 'zod';
import { ingredientQuantitySchema } from '@kitchensink/recipe-core';

import { INGREDIENT_REVIEW_REASONS, type IngredientReviewReason } from '../ingredientLine.js';
import type { ParsedFacts, ParsedLine, ParseEngine, ParseProvenance } from '../parsedLine.js';

/**
 * The `jsonb` payload of a stored parse — a cache row, or a cook's correction.
 *
 * ⛔ `reviewReasons` is REQUIRED. A row written without it is UNREADABLE — `readStoredParse` answers
 * `undefined`, the pipeline reports an unreadable payload and asks the engines again. That is the honest
 * outcome: a judgement cannot be inferred from the measure afterwards, so serving such a row with a
 * derived list would publish a flag no validator raised, and serving it with an empty one would silently
 * unflag a line a validator disputed.
 * ⚠️ A refusal IS a re-parse, and the cache exists to stop those being paid for. That cost is accepted here
 * and paid once per line under `v2`, because the alternative — serving a row whose judgement we invented —
 * cannot be detected downstream.
 */
export interface StoredParse extends ParsedFacts {
    /** What the producer judged about the line. Required — a row without it is unreadable, see the header. */
    readonly reviewReasons: readonly IngredientReviewReason[];
}

/**
 * The payload's schema.
 *
 * ⛔ Annotated `z.ZodType<StoredParse>` rather than inferred, and that annotation is the compile-time
 * guard: adding a member to the contract without a rule here stops the schema satisfying the type, exactly
 * as `ingredientQuantitySchema` is annotated in `recipe-core`. `quantity` REUSES that schema rather than
 * re-authoring the union — there is one representation of "how much", and a stored parse is not the place
 * to fork it; `reviewReasons` reuses `ingredientLine.ts`'s roster for the same reason.
 *
 * ⛔ `strictObject` throughout. `foods` mirrors `ParsedFood` inline because `ParsedFood` is a plain
 * interface with no schema of its own, and the annotation above is what keeps the two in step.
 */
export const storedParseSchema: z.ZodType<StoredParse> = z.strictObject({
    statedMeasure: z.string().nullable(),
    quantity: ingredientQuantitySchema,
    unit: z.string().nullable(),
    foods: z.array(z.strictObject({ name: z.string(), prep: z.string().nullable() })),
    reviewReasons: z.array(z.enum(INGREDIENT_REVIEW_REASONS)),
});

/**
 * Project a parse down to what a row stores.
 *
 * ⛔ An EXPLICIT five-key pick, never a spread of the line minus some keys. The property that matters —
 * "the cook's line never reaches the row" — is then a property of the code a reader can see, rather than of
 * a rest-destructuring that a later field addition would silently widen.
 *
 * ⚠️ It takes a {@link ParsedLine} rather than the narrower {@link ParsedFacts}: a judgement is not a fact,
 * and a caller holding only the facts has nothing to record.
 *
 * @param parsed - The parse to store.
 * @returns The facts and the judgement. Pure.
 */
export function storedParseOf(parsed: ParsedLine): StoredParse {
    return {
        statedMeasure: parsed.statedMeasure,
        quantity: parsed.quantity,
        unit: parsed.unit,
        foods: parsed.foods,
        reviewReasons: parsed.reviewReasons,
    };
}

/**
 * Read a stored payload back, or refuse it.
 *
 * ⛔ Returns `undefined` rather than throwing, because a row this cannot read is a MISS and nothing worse:
 * the caller consults the engines and gets a correct answer. Throwing would turn a superseded row into a
 * failed ingredient line — a stale entry taking down a parse it exists to accelerate.
 *
 * ⚠️ The zod issue list is deliberately DISCARDED rather than reported. Its `input` and its paths quote the
 * payload, and a stored parse holds food names a cook typed; relaying that into a log to explain a cache
 * miss would put user text somewhere KTD-14 spent a whole table design keeping it out of. The FACT that a
 * row was unreadable is what a caller needs, and the pipeline reports that with the row's identity instead.
 *
 * @param payload - The column's value, exactly as the driver handed it over.
 * @returns The stored parse, or `undefined` when the payload is not this generation's shape. Pure.
 */
export function readStoredParse(payload: unknown): StoredParse | undefined {
    const parsed = storedParseSchema.safeParse(payload);

    return parsed.success ? parsed.data : undefined;
}

/**
 * Rebuild the parse a CACHE row stands for.
 *
 * ⚠️ `reviewReasons` is RESTORED WHOLE — never combined with a reading of the measure, and never derived.
 * See the module header for why a row that records none is refused rather than patched. `provenance` is the row's engine throughout,
 * because a per-engine row has exactly one reader by construction.
 *
 * ⛔ NOT the rehydration for a CORRECTION. That one is `promoteCorrection.ts`, and the difference is not
 * cosmetic: a cook supplies `quantity` and `unit` directly, so re-reading their measure phrase could raise
 * `no_quantity` against a fact a human deliberately asserted.
 *
 * @param stored - The row's payload, already read.
 * @param sourceLine - The line as it was SUBMITTED, byte-identical (HAZ-041). The row does not carry it.
 * @param engine - Which engine's row this was.
 * @returns The canonical parse, attributed wholly to that engine. Pure.
 */
export function rehydrateEngineParse(stored: StoredParse, sourceLine: string, engine: ParseEngine): ParsedLine {
    const provenance: ParseProvenance = {
        statedMeasure: engine,
        quantity: engine,
        unit: engine,
        foods: engine,
    };

    return {
        raw: sourceLine,
        statedMeasure: stored.statedMeasure,
        quantity: stored.quantity,
        unit: stored.unit,
        foods: stored.foods,
        reviewReasons: stored.reviewReasons,
        provenance,
    };
}
