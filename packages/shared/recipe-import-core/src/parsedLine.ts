/**
 * THE CANONICAL PARSE RESULT, and the narrowing that keeps today's caller compiling (U16, KTD-18).
 *
 * DESIGN PATTERN: **Value Object** ({@link ParsedLine}) plus an **Adapter** in the narrowing direction
 * ({@link projectToIngredientLine}) — the canonical shape is the wide one, and the narrow shape an
 * existing collaborator expects is DERIVED from it. There is no lift the other way, deliberately: a
 * `ParsedIngredientLine` cannot say how many foods the line named, so promoting one would have to invent
 * the answer.
 *
 * ## ⛔ WHY THE NEW SHAPE IS THE CANONICAL ONE, AND `ParsedIngredientLine` IS NOT WIDENED
 *
 * A real ingredient line names MANY foods (`"chopped onion, celery and carrot"`), a preparation PER food,
 * and a measure in the source's own words that no number can hold (`"the size of an egg"`). Widening
 * `ParsedIngredientLine` in place would break its one caller and — worse — would leave the NARROW shape
 * canonical, so every new consumer would inherit a model that cannot represent the data. Instead the wide
 * shape is canonical and the narrow one becomes a documented projection whose losses are named below and
 * asserted in `__tests__/parsedLine.test.ts`.
 *
 * ⚠️ Every member here is a REQUIRED key, nullable where a line can state nothing — never optional. An
 * optional key lets a construction site keep the old shape and still compile; a required one makes it a
 * compile error, which is the whole point of introducing the contract before the engines that fill it.
 *
 * ## ⛔ `size` IS NOT A MEMBER — owner ruling 2026-08-24, reversing an earlier draft
 *
 * The CRF parser emits a `size` field (`large`, `small`) and an earlier revision of this contract
 * concluded it therefore needed a member of its own. That was wrong, and the reason is worth keeping:
 * **it let a third-party parser's output shape our schema.** `large` is an adjective, and KTD-11b already
 * rules that an adjective is IDENTITY — it belongs in {@link ParsedFood.name}. There is no exception for
 * `large` that does not also reopen `sweet`, `brown` and `Italian`. The CRF's `size` is therefore
 * CANONICALISED into the name by the comparator (U19), exactly as misplaced modifiers are.
 *
 * ⚠️ Accepted consequence: `large onion` and `onion` are distinct names here, so whether they resolve to
 * the same catalog row is the resolution cascade's question — the correct layer for it — not this
 * contract's.
 */
import type { IngredientQuantity } from '@kitchensink/recipe-core';
import type { ParseEngine } from '@kitchensink/recipe-core/parsing/parse-key';

import type { IngredientReviewReason, ParsedIngredientLine } from './ingredientLine.js';

/**
 * Which ENGINE produced a fact — re-exported, never redeclared.
 *
 * ⛔ THIS FILE USED TO DECLARE ITS OWN `'crf' | 'llm'` (ADR-0026's first contract defect). The two spellings
 * were structurally identical, so assignment worked in both directions, `tsc` was silent, and every test
 * passed — the invisible kind of drift, which would have surfaced only when one of them gained a member.
 * The authority is the PARSE KEY, because the engine is a member of that key and of
 * `ingredient_parse_cache.engine`'s CHECK constraint; a copy here could not have carried that consequence.
 *
 * ⚠️ A re-export rather than an import-and-re-declare, following `cookbook-import`'s `parsePrompt.ts` — the
 * precedent for exactly this move, made for exactly this reason ("one authoritative representation,
 * imported"). Consumers of this package keep reading `ParseEngine` off its barrel and never learn that the
 * definition moved.
 */
export type { ParseEngine };

/** One food a line named, and what the line says is done to it. */
export interface ParsedFood {
    /**
     * The food's IDENTITY, in the source's own words.
     *
     * ⛔ Carries every ADJECTIVE (KTD-11b): `sweet`, `brown`, `Italian`, `fresh`, `red`, `green` — and
     * `large`/`small`, which is why this contract has no `size` member. An adjective says WHICH food this
     * is, so moving it out of the name would ask the catalog to resolve a different ingredient.
     */
    readonly name: string;
    /**
     * What is done TO the food, or `null` when the line says nothing.
     *
     * ⛔ KTD-11b is the definition this field carries system-wide, and it is a definition rather than a
     * claim about English:
     *
     *  - a **past participle is preparation** — `chopped`, `grated`, `melted`, `sifted`, `minced`,
     *    `stoned`, `beaten`;
     *  - an **adjective is identity** and belongs in {@link ParsedFood.name} — `sweet`, `brown`,
     *    `Italian`, `fresh`, `red`, `green`;
     *  - **temperature is preparation** — `hot`, `cold`, `boiling`, `lukewarm`, `warm`. The middle case,
     *    committed deliberately.
     *
     * ⚠️ Two traps the ruling was verified against: `red` and `green` end in `-ed`/`-en` and are colours,
     * so a suffix test mis-files them; and `-ed` alone is not a participle test, because `cut`, `ground`
     * and `beaten` are irregular. Whatever classifies a modifier needs an explicit vocabulary, not a regex.
     *
     * ⚠️ Accepted edge: `cooked green peas` files `cooked` as preparation and `green` as identity, and
     * `dried figs` files `dried` as preparation. Both are arguably identity to a cook.
     */
    readonly prep: string | null;
}

/**
 * The facts an ENGINE reads out of a line — a {@link ParsedLine} minus our own bookkeeping.
 *
 * Split out so {@link ParseProvenance} can be DERIVED from it rather than restated. A fact added here
 * without an engine to attribute it becomes a compile error at every construction site, which is the
 * property a hand-written provenance list cannot have.
 */
export interface ParsedFacts {
    /**
     * The measure phrase EXACTLY as the source stated it (`"one tablespoon"`, `"a little"`, `"a sprig"`),
     * or `null` when the line states none.
     *
     * ⛔ `null` is the one representation of "no measure stated". An empty string is NOT a second one: the
     * engines return both (`""` from the CRF, `null` from the LLM) and they must normalize to the same
     * value here, or the parse cache partitions on a distinction that carries no meaning.
     *
     * ⚠️ This is the source's WORDS, not a reading of them. It exists because the comparator compares the
     * STATED pair — two engines disagreeing about `"one tablespoon"` is a different fact from two engines
     * disagreeing about the number 1 — and because a measure like `"the size of an egg"` states something
     * real that {@link ParsedFacts.quantity} is right to record as absent.
     */
    readonly statedMeasure: string | null;
    /**
     * How much the line calls for: an exact amount, a two-bound range, or nothing the source stated.
     *
     * ⛔ `absent` is NEVER a fabricated `1` and never a `0` (R40). Reuses recipe-core's union rather than
     * introducing a second quantity model — there is one representation of "how much", and a parse result
     * is not the place to fork it.
     */
    readonly quantity: IngredientQuantity;
    /** The unit, canonicalised by recipe-core's `normalizeUnit`, or `null` when the line states none. */
    readonly unit: string | null;
    /**
     * Every food the line named, in the order the line named them.
     *
     * ⚠️ May be empty: a line that named no food (a heading, an instruction the segmenter admitted) is a
     * fact about the line, not a failure. The producer says why in {@link ParsedLine.reviewReasons}.
     */
    readonly foods: readonly ParsedFood[];
}

/**
 * Which READER produced a fact — an engine, or a person.
 *
 * ⛔ A SECOND AXIS, and deliberately NOT a third member of `PARSE_ENGINES` (ADR-0026's second contract
 * defect). `ParseProvenance` used to be keyed on `ParseEngine` alone, which left U21's shipped
 * correction tier UNTYPEABLE: a cook is neither `crf` nor `llm`, so a line carrying a corrected amount
 * beside an engine's foods could not be expressed at all.
 *
 * ⛔ The obvious repair — adding `'correction'` to `PARSE_ENGINES` — is the wrong one, and its own module
 * says why: that set is `ingredient_parse_cache.engine`'s CHECK-constrained key domain, where a third
 * member is "a compile error **and a migration** — never a value that quietly appears in a cache row nobody
 * can interpret". A correction is not a cache row and has no engine version; it is a different KIND of
 * source. So the two sets stay separate: {@link ParseEngine} is what a cache row may say, and this is what
 * a FACT may say. Every engine is a source; the reverse does not hold, which is the whole point.
 */
export type ParseFactSource = ParseEngine | 'correction';

/**
 * Which reader produced each fact.
 *
 * ⛔ DERIVED from {@link ParsedFacts}, never enumerated — the same discipline as `UNIT_WORDS` in
 * `ingredientLine.ts` and the guard tables in `packages/infra/global/__tests__/`. A hand-written list is
 * a second representation of the fact set and rots the moment a fact is added.
 */
export type ParseProvenance = { readonly [Fact in keyof ParsedFacts]: ParseFactSource };

/**
 * One free-text ingredient line, parsed — the CANONICAL result of the parse pipeline.
 *
 * ⚠️ There is deliberately no `needsReview` mirror of `ParsedIngredientLine`'s. It is exactly
 * `reviewReasons.length > 0`, and a stored copy of a derivable fact is a second place for it to be wrong.
 * The projection computes it for the caller that speaks in that flag.
 */
export interface ParsedLine extends ParsedFacts {
    /**
     * The input, byte-identical and UNCONDITIONAL (HAZ-041) — including for a blank line, a heading, or a
     * line no engine could read.
     */
    readonly raw: string;
    /**
     * Why this line still wants a human's eye. Empty when it parsed cleanly.
     *
     * Shares `ingredientLine.ts`'s taxonomy rather than opening a second one: a reason means the same
     * thing whichever reader raised it, and `corruptsStatedValue` must stay total over ONE union.
     */
    readonly reviewReasons: readonly IngredientReviewReason[];
    /** Which engine produced each fact — see {@link ParseProvenance}. */
    readonly provenance: ParseProvenance;
    /**
     * How many LLM parse attempts produced this line's LLM-side answer (plan U7, R8): `1` for a
     * first-try pass, up to the loop's maximum when validator failures fed retries. Absent for a line the
     * validated leg never touched (the CRF's own answers, cache/correction tiers, and single-engine-CRF
     * merges). ⚠️ META, deliberately NOT a member of {@link ParsedFacts}: it has no per-fact provenance
     * and the comparator never compares it — it rides through so agreement stats can be sliced by attempt
     * count without a second bookkeeping channel.
     */
    readonly llmAttempts?: number | undefined;
}

/**
 * The reason the projection raises for itself, named once so the append and the de-duplication agree.
 */
const ADDITIONAL_FOODS_DROPPED: IngredientReviewReason = 'additional_foods_dropped';

/**
 * Narrow a {@link ParsedLine} to the shape `ParsedIngredientLine`'s callers already compile against.
 *
 * ## ⛔ WHAT THIS DROPS — the loss is the contract, not a detail
 *
 * | dropped                                   | told to the caller?                                          |
 * | ----------------------------------------- | ------------------------------------------------------------ |
 * | every food after the first                | **YES** — `additional_foods_dropped`                          |
 * | `prep`, on the food that survives         | no — see below                                                 |
 * | `statedMeasure`, the source's own words   | no — but see the correction below                              |
 * | `provenance`                              | no — the narrow shape has no field for it and no caller asks   |
 *
 * ⛔ Only the dropped FOODS raise a reason, and the line is where the reasons stop. A food is an IDENTITY:
 * losing one loses an ingredient the recipe calls for, which nothing downstream can recover. `prep` is not
 * identity under KTD-11b — the surviving name is exactly as resolvable without it.
 *
 * ⚠️ CORRECTED 2026-08-25 (U31). This table used to justify dropping `statedMeasure` with "its READING
 * survives as `quantity` + `unit`", and that is only true of a measure a number can hold. For the class
 * `statedMeasure` was INTRODUCED for — `"the size of an egg"`, `"a handful"`, which its own docstring says
 * `quantity` is right to record as ABSENT — the reading is `absent` + `null`, so nothing survives it.
 * What actually carries those words is {@link ParsedLine.raw}, which this projection passes through
 * byte-identical: the measure is not lost, only the knowledge of WHICH SPAN of `raw` was the measure. And
 * the reason to review it comes from the PRODUCER (`no_quantity`), never from here — see the paragraph
 * below on why this adds no reason of its own.
 *
 * ⛔ It adds NO reason of its own beyond that one, even where it can see something amiss. A `ParsedLine`
 * with an absent quantity, or with no food at all, was already judged by its producer, and re-deriving
 * that judgement here would be a second representation of `ingredientLine.ts`'s taxonomy — free to drift,
 * and free to contradict the reasons already on the line. The projection reports only the loss IT causes.
 *
 * ⚠️ The de-duplication is not defensive noise: `ParsedLine` is a plain interface with no smart
 * constructor, so a producer that has already recorded the drop can hand one in, and a caller shown the
 * same review message twice would reasonably read it as two problems.
 *
 * @param parsed - The canonical parse.
 * @returns The narrow line: the first food's name, the quantity and unit unchanged, and every review
 *   reason the parse carried plus `additional_foods_dropped` when a food was lost. Pure and TOTAL — a
 *   line that named no food projects to an empty name rather than throwing.
 */
export function projectToIngredientLine(parsed: ParsedLine): ParsedIngredientLine {
    const [survivor, ...dropped] = parsed.foods;
    const lostAFood = dropped.length > 0 && !parsed.reviewReasons.includes(ADDITIONAL_FOODS_DROPPED);
    const reviewReasons: readonly IngredientReviewReason[] = lostAFood
        ? [...parsed.reviewReasons, ADDITIONAL_FOODS_DROPPED]
        : [...parsed.reviewReasons];

    return {
        raw: parsed.raw,
        quantity: parsed.quantity,
        unit: parsed.unit,
        name: survivor?.name ?? '',
        needsReview: reviewReasons.length > 0,
        reviewReasons,
    };
}
