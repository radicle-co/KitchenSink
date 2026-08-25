/**
 * @module promoteCrfReading — the CRF's flattened row, as a {@link ParsedLine} (plan U22, phase 3).
 *
 * DESIGN PATTERN: **Adapter**, in the strict sense — it translates one shape into another and adds no
 * behaviour of its own. Every judgement it appears to make was already made somewhere else: the amount and
 * the unit by {@link readStatedMeasure}, the placement of a modifier by the comparator, and the ruling that
 * `size` is identity by U16. What is left here is field mapping and one contract to enforce.
 *
 * ## ⛔ THIS MODULE IS WHY U22 COULD NOT COMPILE
 *
 * `compareParses` consumes two `ParsedLine`s. `llmParse` produces an `LlmParse`. The CRF Lambda produces a
 * flattened row. Nothing in the tree promoted either engine's output into the canonical shape, and
 * `parseAnswer.ts` says "the comparator owns" that step — which it does not. This module and its sibling
 * `promoteLlmParse` are that step.
 *
 * ## ⛔ IT IS TRANSPORT-FREE, AND STRUCTURALLY TYPED FOR THAT REASON
 *
 * {@link CrfReading} is the ROW and nothing else. Two envelopes carry it and they genuinely differ — a JSONL
 * line from the measurement sidecar (`cookbook-import`'s `crfParse.ts`) and a Lambda response carrying
 * `status`, `engine` and `engineVersion` (`ingredient-parser`'s `engine.schema.ts`) — so the envelopes stay
 * where they are and only the row is shared. Each of those zods asserts its inferred row assignable to this
 * type in its OWN package, because a shared package must never import a service's.
 *
 * ## ⛔ `raw` IS A PARAMETER, AND THE TWO CONTRACTS ARE WHY
 *
 * `crfParse.ts` documents `sentence` as "the line as it was submitted, echoed back"; `engine.schema.ts`
 * documents the SAME field as "the parser's NORMALISED sentence". They cannot both be true, and HAZ-041
 * requires `ParsedLine.raw` to be the input byte-identical. So the caller — which holds the line it sent —
 * supplies it, and this adapter never has to decide which docstring to believe.
 */
import type { ParsedFood, ParsedLine, ParseProvenance } from '../parsedLine.js';

import { readStatedMeasure } from './readStatedMeasure.js';

/**
 * ONE READING BY THE CRF ENGINE — the row both of its envelopes carry.
 *
 * ⚠️ Every field is the parser's OWN text, never re-rendered by us. `measure` is `''` (not `null`) when it
 * read none, which is the collapse {@link promoteCrfReading} performs.
 */
export interface CrfReading {
    /** The sentence the engine read. ⛔ NOT necessarily the source line — see the module header. */
    readonly sentence: string;
    /** The parser's own amount text, joined when it read several. Empty when it read none. */
    readonly measure: string;
    /** The parser's own name texts, in the order it produced them. */
    readonly names: readonly string[];
    /** `large`/`small` — an adjective, which KTD-11b files as IDENTITY. Canonicalised into the name. */
    readonly size: string | null;
    /** What the line says is done to the food, or `null`. */
    readonly preparation: string | null;
    /** Trailing matter the parser declined to call a name or a preparation. Discarded — see below. */
    readonly comment: string | null;
}

/** Every fact on this line was read by the CRF, because the CRF is the only reader involved. */
const CRF_THROUGHOUT: ParseProvenance = { statedMeasure: 'crf', quantity: 'crf', unit: 'crf', foods: 'crf' };

/**
 * Collapse a stated-or-not text field to its ONE representation.
 *
 * ⛔ U16: `null` is the single representation of "the source said nothing here". The CRF returns `''` and
 * the LLM returns `null` for the same fact, and if both survived, the parse cache would partition on a
 * distinction carrying no meaning and the comparator would report a disagreement between two engines that
 * agree there is nothing to state.
 *
 * @param value - The engine's text for the field.
 * @returns The trimmed text, or `null` when it states nothing. Pure.
 */
function stated(value: string | null): string | null {
    const trimmed = value?.trim() ?? '';

    return trimmed === '' ? null : trimmed;
}

/**
 * Whether a name already says the size, so saying it again would corrupt the identity.
 *
 * ⚠️ The CRF's labels are mutually exclusive, so a token labelled SIZE is not also in a name and this
 * should never fire against the real engine. It is here because the failure it prevents is the one class
 * this package treats as unrecoverable: `"large large onion"` resolves against the catalog as a different
 * food, and no later reader could tell that the duplication was ours.
 *
 * @param name - One food's identity, as the engine wrote it.
 * @param size - The size word.
 * @returns `true` when the name already carries that word. Pure.
 */
function alreadySaysTheSize(name: string, size: string): boolean {
    const folded = size.toLowerCase();

    return name.split(/\s+/u).some((word) => word.toLowerCase() === folded);
}

/**
 * Turn the engine's flat `names`/`size`/`preparation` triple into the foods the line named.
 *
 * ⛔ `size` goes into the NAME, not into `prep`. U16's ruling is that `large` is an adjective and an
 * adjective says WHICH food this is; there is no exception for `large` that does not also reopen `sweet`,
 * `brown` and `Italian`. Doing it here rather than leaving it to the comparator's placement rule matters
 * because a promoted line is CACHED per engine (U20): a cached row filing an adjective under preparation
 * would contradict KTD-11b at rest and be served to every later reader. The result is idempotent — the
 * comparator's `canonicaliseFood` moves nothing on it — which is asserted, not assumed.
 *
 * ⚠️ Both `size` and `preparation` are DISTRIBUTED across every name, because the sidecar flattens a
 * per-token label into one field and the adjacency that said which food it belonged to is already gone.
 * Attaching either to the first name only would silently drop it for the rest. The accepted cost is on a
 * multi-name row, where distributing `size` asserts an adjective of foods it may not have modified —
 * bounded in practice by `DEFAULT_WINNERS`, which takes `foods` from the LLM whenever both engines answered.
 *
 * @param reading - The engine's row.
 * @returns One food per non-empty name, in the order the engine produced them. Pure.
 */
function foodsOf(reading: CrfReading): readonly ParsedFood[] {
    const size = stated(reading.size);
    const prep = stated(reading.preparation);

    return reading.names.flatMap((rawName) => {
        const name = rawName.trim();

        // ⛔ A nameless food has no identity to resolve, so keeping it would put an entry on a cook's
        // ingredient list that names nothing. `normalizeParseAnswer` drops the same shape for the same
        // reason; dropping it is lossless in the only sense that matters — there was nothing there.
        if (name === '') {
            return [];
        }

        const identity = size === null || alreadySaysTheSize(name, size) ? name : `${size} ${name}`;

        return [{ name: identity, prep }];
    });
}

/**
 * Promote one CRF reading to the canonical parse.
 *
 * ⚠️ `comment` is DISCARDED. It is the parser's own "trailing matter I declined to call a name or a
 * preparation", and `ParsedLine` has no field for it. Giving it one would let a third-party parser's output
 * shape our schema — precisely the mistake U16 recorded and reversed for `size`. Nothing is lost: `raw`
 * carries the whole line byte-identical, so a later reader still has the words.
 *
 * @param reading - The engine's row for this line.
 * @param sourceLine - The line as it was SUBMITTED, byte-identical (HAZ-041). See the module header on why
 *   this is not taken from {@link CrfReading.sentence}.
 * @returns The canonical parse, attributed wholly to the CRF. Pure and TOTAL — a row the engine read
 *   nothing out of promotes to a line with no foods and an absent quantity, which is a fact rather than a
 *   failure.
 */
export function promoteCrfReading(reading: CrfReading, sourceLine: string): ParsedLine {
    const statedMeasure = stated(reading.measure);
    const measure = readStatedMeasure(statedMeasure);

    return {
        raw: sourceLine,
        statedMeasure,
        quantity: measure.quantity,
        unit: measure.unit,
        foods: foodsOf(reading),
        reviewReasons: measure.reviewReasons,
        provenance: CRF_THROUGHOUT,
    };
}
