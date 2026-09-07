/**
 * @module promoteLlmParse — the model's reading, as a {@link ParsedLine} (plan U22, phase 3).
 *
 * DESIGN PATTERN: **Adapter**, the sibling of `promoteCrfReading` and shaped identically on purpose —
 * same signature, same measure reader, same `null`-never-`''` collapse — so that a fact read by one engine
 * and a fact read by the other differ only in WHAT was read, never in HOW it was turned into a value.
 *
 * ## ⛔ THIS IS THE "SEPARATE READING" `parseAnswer.ts` PROMISED SOMEBODY ELSE WOULD DO
 *
 * That module says an `LlmParse` is "deliberately NOT a `ParsedLine`… turning `"2 cups"` into a quantity
 * and a canonical unit is a separate reading that **the comparator owns**, because it is the step where the
 * two engines' answers are put in one vocabulary before being compared." The comparator does not do it — it
 * takes two `ParsedLine`s and nothing else — so the step had no home. It has one now, and the "one
 * vocabulary" property is preserved by both adapters calling {@link readStatedMeasure}.
 *
 * ## ⛔ IT DOES NOT RE-FILE THE MODEL'S MODIFIERS
 *
 * KTD-11b placement is settled by the comparator's canonicalisation, applied to BOTH engines' answers
 * immediately before they are compared and to the merged line that is stored. Doing it here as well would
 * be a second copy of that rule, free to drift from the one the comparison actually uses — and it would
 * mean the CACHED per-engine parse no longer said what the engine said, which is the one thing a
 * per-engine cache row is for.
 *
 * ⚠️ That is the deliberate ASYMMETRY with `promoteCrfReading`, which does move one word: `size` is not a
 * placement decision, it is a FIELD the canonical shape refuses to have (U16), so the adapter has to put it
 * somewhere and identity is where the ruling puts it. The model has no `size` field at all.
 */
import { normalizeUnit } from '@kitchensink/recipe-core';
import type { LlmParse } from '@kitchensink/recipe-core/parsing/parse-answer';

import type { ParsedFood, ParsedLine, ParseProvenance } from '../parsedLine.js';

import { readStatedMeasure } from './readStatedMeasure.js';

/** Every fact on this line was read by the model, because the model is the only reader involved. */
const LLM_THROUGHOUT: ParseProvenance = { statedMeasure: 'llm', quantity: 'llm', unit: 'llm', foods: 'llm' };

/**
 * Collapse a stated-or-not text field to its ONE representation.
 *
 * ⚠️ `normalizeParseAnswer` already does this at the model boundary, so this can only ever be a no-op on an
 * answer that came through it. It is here because the invariant belongs to the VALUE, not to one producer
 * of it: `LlmParse` is a plain interface with no smart constructor, and a hand-built one — a fixture, a
 * replayed cache row — must not be able to introduce the second representation through this door.
 *
 * @param value - The model's text for the field.
 * @returns The trimmed text, or `null` when it states nothing. Pure.
 */
function stated(value: string | null): string | null {
    const trimmed = value?.trim() ?? '';

    return trimmed === '' ? null : trimmed;
}

/**
 * Promote one model reading to the canonical parse.
 *
 * @param parse - The model's reading of this line, already normalized at the answer boundary.
 * @param sourceLine - The line the model was shown, byte-identical (HAZ-041). `LlmParse` carries no `raw`
 *   of its own — the answer holds only what was read — so reconstructing one here would publish the model's
 *   words as the cook's.
 * @returns The canonical parse, attributed wholly to the LLM. Pure and TOTAL — an answer naming no food
 *   promotes to a line with no foods, which is a legitimate answer about a heading rather than a failure.
 */
export function promoteLlmParse(parse: LlmParse, sourceLine: string): ParsedLine {
    const statedMeasure = stated(parse.statedMeasure);
    // ⛔ THE MODEL'S OWN SPLIT, not a re-derivation from the phrase (owner ruling 2026-08-27). Feeding the
    // rejoined phrase back through `readStatedMeasure` — which parses it with `parseIngredientLine`, built
    // for RAW lines — DROPPED the unit on 67 of 205 measured gold records (32.7%): `16 slices`, `2 handfuls`,
    // `1 heaped tbsp`. The model had already split them correctly.
    //
    // ⚠️ THE SHARED VOCABULARY IS PRESERVED WHERE IT MATTERS. `promoteCrfReading` and this adapter must turn
    // a fact into a value the same way — but the CRF hands over a PHRASE and must have it parsed, while the
    // model hands over a SPLIT. The common step is the NORMALISATION (`normalizeUnit`, and the same amount
    // reader), not the phrase parsing, so both engines' units still land in one vocabulary.
    // ⛔ THE TWO HALVES ARE INDEPENDENT. A producer may state a unit and no amount — a bake-off arm with a
    // unit slot but no quantity slot does exactly that — so one `splitSupplied` flag governing both would
    // read the amount out of a field that producer never fills, and publish `absent` for a stated number.
    //
    // ⛔ `undefined` means "not stated by this producer — derive from the phrase", which is every pre-v5
    // caller. `null` means "the producer HAS this slot and read nothing in it", which is a reading and is
    // taken at face value. Collapsing them would silently re-derive on exactly the lines where the model
    // disagreed with our derivation — the same distinction `VariantParse.statedUnit` already documents.
    const measure =
        parse.statedQuantity === undefined
            ? readStatedMeasure(statedMeasure)
            : readStatedMeasure(stated(parse.statedQuantity));
    const foods: readonly ParsedFood[] = parse.foods.map((food) => ({ name: food.name, prep: food.prep }));

    return {
        raw: sourceLine,
        statedMeasure,
        quantity: measure.quantity,
        // ⚠️ `normalizeUnit` is TOTAL — an unrecognised word is de-pluralised and KEPT, never rejected, which
        // is the ruling this line implements. An unconvertible unit still fails SAFE to null grams downstream.
        unit: readUnit(parse.statedUnit, measure.unit),
        foods,
        reviewReasons: measure.reviewReasons,
        provenance: LLM_THROUGHOUT,
    };
}

/**
 * The unit a producer STATED, or our derivation when it states none of its own.
 *
 * ⚠️ `normalizeUnit` is TOTAL — an unrecognised word is de-pluralised and KEPT, never rejected. That is the
 * owner's 2026-08-27 ruling ("handfuls is fine as a unit") and the vocabulary already agreed with it:
 * `classifyUnit` records that a cook "may write anything in the unit field… and the wire stores it
 * unchanged". An unconvertible unit still fails SAFE to null grams downstream, as `small`/`large` do.
 *
 * @param stated - What the producer said, `null` if it read none, `undefined` if it has no unit slot.
 * @param derived - The unit read out of the phrase, used only when the producer has no slot.
 * @returns The canonical unit, or `null`. Pure.
 */
function readUnit(stated: string | null | undefined, derived: string | null): string | null {
    if (stated === undefined) {
        return derived;
    }

    const trimmed = stated?.trim() ?? '';

    return trimmed === '' ? null : normalizeUnit(trimmed);
}
