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
 * ## ⛔ NOTHING DERIVABLE IS STORED — the three fields a row does not need
 *
 * | dropped         | where it comes back from                                                          |
 * | --------------- | --------------------------------------------------------------------------------- |
 * | `raw`           | the caller, which holds the line it asked about (the same reason both promotion adapters take it as a parameter) |
 * | `provenance`    | the row's own `engine` column — a per-engine row has exactly one reader            |
 * | `reviewReasons` | {@link readStatedMeasure} over `statedMeasure`, which is what BOTH promotions already derive them with |
 *
 * The third is the one worth stating, and its strongest argument is not economy — it is that
 * `engineVersion` **does not cover our promoter**. That key is "the CRF package + model pin, or the LLM's
 * model id + prompt version"; the reading `readStatedMeasure` performs is ours and is in neither. A STORED
 * `reviewReasons` would therefore be frozen under a version key that cannot re-partition it: change the
 * reader and every old row keeps serving the old reasons, with no lever to reclaim them. A DERIVED one is
 * current by construction.
 *
 * ⚠️ It holds only while every promotion adapter derives its reasons from the measure alone, so
 * `__tests__/storedParseFacts.test.ts` asserts the round trip over BOTH adapters and
 * `tests/parsePipeline.integration.test.ts` asserts it over the whole committed corpus slice. An adapter
 * that starts raising a reason of its own turns those red rather than silently shipping a corpus whose
 * flags evaporated on the way through the cache.
 *
 * ⛔ {@link rehydrateEngineParse} is a SEPARATE derivation from the promoters', deliberately, and must not
 * be "DRYed" into a helper they share. The round-trip property is only evidence because two independently
 * written derivations agree; fold them together and the test proves that a function equals itself.
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

import type { ParsedFacts, ParsedLine, ParseEngine, ParseProvenance } from '../parsedLine.js';

import { readStatedMeasure } from './readStatedMeasure.js';

/**
 * The `jsonb` payload of a stored parse — a cache row, or a cook's correction.
 *
 * ⛔ Annotated `z.ZodType<ParsedFacts>` rather than inferred, and that annotation is the compile-time
 * guard: adding a fact to the contract without a rule here stops the schema satisfying the type, exactly as
 * `ingredientQuantitySchema` is annotated in `recipe-core`. `quantity` REUSES that schema rather than
 * re-authoring the union — there is one representation of "how much", and a stored parse is not the place
 * to fork it.
 *
 * ⛔ `strictObject` throughout. `foods` mirrors `ParsedFood` inline because `ParsedFood` is a plain
 * interface with no schema of its own, and the annotation above is what keeps the two in step.
 */
export const storedParseFactsSchema: z.ZodType<ParsedFacts> = z.strictObject({
    statedMeasure: z.string().nullable(),
    quantity: ingredientQuantitySchema,
    unit: z.string().nullable(),
    foods: z.array(z.strictObject({ name: z.string(), prep: z.string().nullable() })),
});

/**
 * Project a parse down to what a row stores.
 *
 * ⛔ An EXPLICIT four-key pick, never a spread of the line minus some keys. The property that matters —
 * "the cook's line never reaches the row" — is then a property of the code a reader can see, rather than of
 * a rest-destructuring that a later field addition would silently widen.
 *
 * @param parsed - The parse to store.
 * @returns Just the facts. Pure.
 */
export function storedFactsOf(parsed: ParsedFacts): ParsedFacts {
    return {
        statedMeasure: parsed.statedMeasure,
        quantity: parsed.quantity,
        unit: parsed.unit,
        foods: parsed.foods,
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
 * @returns The facts, or `undefined` when the payload is not this generation's shape. Pure.
 */
export function readStoredParseFacts(payload: unknown): ParsedFacts | undefined {
    const parsed = storedParseFactsSchema.safeParse(payload);

    return parsed.success ? parsed.data : undefined;
}

/**
 * Rebuild the parse a CACHE row stands for.
 *
 * ⚠️ `reviewReasons` is RE-DERIVED, not restored — see the module header for why that is lossless and what
 * asserts it. `provenance` is the row's engine throughout, because a per-engine row has exactly one reader
 * by construction.
 *
 * ⛔ NOT the rehydration for a CORRECTION. That one is `promoteCorrection.ts`, and the difference is not
 * cosmetic: a cook supplies `quantity` and `unit` directly, so re-reading their measure phrase could raise
 * `no_quantity` against a fact a human deliberately asserted.
 *
 * @param facts - The row's payload, already read.
 * @param sourceLine - The line as it was SUBMITTED, byte-identical (HAZ-041). The row does not carry it.
 * @param engine - Which engine's row this was.
 * @returns The canonical parse, attributed wholly to that engine. Pure.
 */
export function rehydrateEngineParse(facts: ParsedFacts, sourceLine: string, engine: ParseEngine): ParsedLine {
    const provenance: ParseProvenance = {
        statedMeasure: engine,
        quantity: engine,
        unit: engine,
        foods: engine,
    };

    return {
        raw: sourceLine,
        statedMeasure: facts.statedMeasure,
        quantity: facts.quantity,
        unit: facts.unit,
        foods: facts.foods,
        reviewReasons: readStatedMeasure(facts.statedMeasure).reviewReasons,
        provenance,
    };
}
