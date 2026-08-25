/**
 * THE MODEL'S ANSWER — the inbound boundary of the LLM parse leg, and where U16's `null`-never-`''` invariant
 * stops being documentation and becomes true.
 *
 * DESIGN PATTERN: **parse, don't validate** at a third-party boundary, plus a **normalizing factory**. The
 * zod describes what the MODEL is allowed to have said; {@link normalizeParseAnswer} turns that into the one
 * value the rest of the system may hold. Nothing downstream ever sees {@link ModelParseAnswer}.
 *
 * ⛔ **This is the model's shape, NOT ours, and the two are deliberately different types.** ADR-0014 / §15.3:
 * a third-party API we do not serve has no service of ours whose zod could own its shapes, so it is validated
 * at the boundary with our own zod and MAY declare its own type. Reusing `ParsedFood` here would assert that
 * an LLM response IS one of our value objects, and would couple the prompt's wire shape to a domain model
 * that changes for entirely different reasons.
 *
 * ⛔ **Reachable ONLY as `@kitchensink/recipe-core/parsing/parse-answer`** — the barrel is inside
 * recipe-service's `CONTRACT_HASH` fingerprint, and this module has no wire projection at all.
 *
 * ## ⛔ WHY `"measure": null` IS ACCEPTED, WHEN THE PROMPT ASKED FOR A STRING
 *
 * This is the single largest measured "failure" of both candidate models, and it is not a failure. Across the
 * 2026-08-23 comparison it accounts for **503 of Nova Micro's 508 non-compliant responses and 267 of Pro's
 * 268**, and it fires almost only on lines that state no measure — i.e. the model is answering CORRECTLY, in
 * a shape we did not think to specify. Refusing it would discard ~1% of good answers and would file a SCHEMA
 * decision of ours as a MODEL defect, which is the kind of number that then gets used to pick a model.
 *
 * ⚠️ The prompt is NOT reworded to ask for `string|null`. The wording is the measured artifact
 * (`parsePrompt.ts`); the reader is where we absorb the difference, at no cost to the comparability of the
 * figures.
 *
 * ## ⛔ AND ACCEPTING BOTH IS ONLY HALF THE JOB — THEY MUST COLLAPSE
 *
 * `null` and `""` must normalize to the SAME absent-measure value, or plan U20's parse cache partitions on a
 * distinction that carries no meaning: two keys, two billed Bedrock calls, one fact — and, worse, a
 * comparator that reports the two engines disagreeing about a measure when they agree that there isn't one.
 * `parsedLine.ts` states the invariant ("`null` is the one representation of 'no measure stated'. An empty
 * string is NOT a second one") and cannot enforce it, because it is a plain interface with no smart
 * constructor. This is the boundary where it is enforced.
 *
 * ⚠️ The same collapse applies to `prep`, which the prompt already declares as `string|null`. A model that
 * answers `""` for "the line says nothing to do" is saying exactly what `null` says, and two representations
 * of one fact would manufacture a preparation disagreement between two engines that agree.
 */
import { z } from 'zod';

/**
 * The answer shape, as the model is permitted to send it.
 *
 * ⛔ `strictObject`, not `object`. The prompt names the WHOLE document ("Answer with this JSON and nothing
 * else"); a response carrying an extra field is not the document that was asked for. Accepting it would let
 * an injected instruction's echo ride along in a key nothing reads, and would report a contract compliance
 * the reader does not actually enforce.
 *
 * ⛔ `measure` is `string | null` and NOTHING WIDER. A number is not admitted: this field is the source's own
 * WORDS, and a numeric measure is a reading of them — the reading is `quantity`'s job, downstream, where
 * `absent` is representable and a fabricated `1` is not (R40).
 */
export const modelParseAnswerSchema = z.strictObject({
    measure: z.string().nullable(),
    foods: z.array(z.strictObject({ name: z.string(), prep: z.string().nullable() })),
});

/** What the model said, validated but not yet normalized. Internal to this boundary. */
export type ModelParseAnswer = z.infer<typeof modelParseAnswerSchema>;

/** One food the model named, and what it says is done to it. */
export interface LlmParsedFood {
    /** The food's identity in the line's own words, trimmed. Never empty — see {@link normalizeParseAnswer}. */
    readonly name: string;
    /** What the line says to do to it, trimmed, or `null` when the line says nothing. Never `''`. */
    readonly prep: string | null;
}

/**
 * The LLM leg's reading of one line — the value the comparator (U19) receives and the cache (U20) keys on.
 *
 * ⚠️ Deliberately NOT a `ParsedLine`. This leg reads what the line SAYS; turning `"2 cups"` into a quantity
 * and a canonical unit is a separate reading that the comparator owns, because it is the step where the two
 * engines' answers are put in one vocabulary before being compared. Promoting here would mean doing it twice,
 * differently.
 */
export interface LlmParse {
    /** The measure phrase exactly as the line stated it, trimmed, or `null` when it stated none. Never `''`. */
    readonly statedMeasure: string | null;
    /** Every food the model named, in order. May be empty — a line that named no food is a fact, not a fault. */
    readonly foods: readonly LlmParsedFood[];
}

/**
 * Collapse a stated-or-not text field to its ONE representation.
 *
 * @param value - The model's value for the field.
 * @returns The trimmed text, or `null` when the model stated nothing. Pure.
 */
function stated(value: string | null): string | null {
    const trimmed = value?.trim() ?? '';

    return trimmed === '' ? null : trimmed;
}

/**
 * Turn a validated answer into the one value the system may hold.
 *
 * ⛔ A food with no name is DROPPED rather than carried. A nameless food has no identity to resolve against
 * the catalog, so keeping it would put an entry on a cook's ingredient list that names nothing, and would
 * make the comparator score an empty string against a real food name as a disagreement. Dropping it is
 * lossless in the only sense that matters here — there was nothing there.
 *
 * @param answer - The model's answer, already validated by {@link modelParseAnswerSchema}.
 * @returns The normalized reading. Pure.
 */
export function normalizeParseAnswer(answer: ModelParseAnswer): LlmParse {
    return {
        statedMeasure: stated(answer.measure),
        foods: answer.foods.flatMap((food) => {
            const name = food.name.trim();

            return name === '' ? [] : [{ name, prep: stated(food.prep) }];
        }),
    };
}
