/**
 * THE FOODNESS VALIDATOR'S ANSWER READER (plan U6, KTD-E) — three-valued, with the consistency
 * cross-check the holdout evidence demanded.
 *
 * DESIGN PATTERN: total reader over untrusted model output, the `verdict.ts` discipline: it answers with
 * a typed verdict or a named refusal, never a throw — a `throw` here would need a `catch` whose default
 * is exactly the wrong direction.
 *
 * ## ⛔ THREE VALUES, AND COULD-NOT-JUDGE IS NEVER A VERDICT
 *
 * `judged` (with the verdict), or `could-not-judge` (with the reason). A truncated, unparseable, or
 * internally contradictory answer is ABSENCE — the ADR-0026 §3 rule one layer up: collapsing "the model
 * could not answer" into "the model said not-food" would turn a transient model hiccup into a permanent
 * fact about an ingredient, and the retry loop (U7) treats could-not-judge as NOT an attempt.
 *
 * ## The taxonomy-vs-boolean CONSISTENCY CROSS-CHECK — holdout-evidenced
 *
 * Most residual holdout errors were INTERNAL CONTRADICTIONS: `isFood: true` beside a taxonomy the model
 * itself uses for non-foods (`unknown word`, `equipment`, …). A verdict at war with its own taxonomy is
 * not a judgement — it is the model hedging — so it reads as could-not-judge, and the caller retries or
 * falls through rather than acting on either half.
 */
import { z } from 'zod';

/** The wire shape the pinned prompt demands. `strict` — an extra key is chat, and chat is unreadable. */
const foodnessWireSchema = z
    .object({
        isFood: z.boolean(),
        taxonomy: z.string().min(1).max(200),
    })
    .strict();

/**
 * Taxonomies the model itself uses to mean "this is NOT a food". Lowercased substring match, because the
 * open taxonomy (owner ruling: never limit what it can be) means these arrive in free variation
 * ("unknown word", "unknown term", "kitchen equipment"). ⚠️ Consulted ONLY for the contradiction check
 * against `isFood: true` — an `isFood: false` verdict stands whatever its taxonomy says.
 */
const NON_FOOD_TAXONOMY_MARKERS = ['unknown', 'equipment', 'utensil', 'not a food', 'not food', 'nonfood'];

/** A judged verdict. */
export interface FoodnessVerdict {
    readonly kind: 'judged';
    readonly isFood: boolean;
    /** The model's open-taxonomy label, verbatim. */
    readonly taxonomy: string;
}

/** The reader could not extract a usable judgement. NOT a verdict — never counts as an attempt (U7). */
export interface FoodnessUnreadable {
    readonly kind: 'could-not-judge';
    readonly reason: 'no-json' | 'bad-shape' | 'contradiction' | 'truncated';
}

/** What reading one model answer produced. */
export type FoodnessReading = FoodnessVerdict | FoodnessUnreadable;

/**
 * Read one model answer.
 *
 * @param text - The model's raw output text.
 * @param stopReason - Bedrock's stop reason; `max_tokens` means the answer was cut mid-thought.
 * @returns The reading. Pure, total.
 */
export function readFoodnessAnswer(text: string, stopReason: string): FoodnessReading {
    if (stopReason === 'max_tokens') {
        // A truncated answer may have lost its closing brace or half its taxonomy — nothing in it is
        // trustworthy, including a JSON object that happens to have closed before the cut.
        return { kind: 'could-not-judge', reason: 'truncated' };
    }

    // Non-greedy, first object only — the model sometimes wraps JSON in prose despite the instruction.
    const match = /\{[\s\S]*?\}/.exec(text);

    if (match === null) {
        return { kind: 'could-not-judge', reason: 'no-json' };
    }

    let parsed: unknown;

    try {
        parsed = JSON.parse(match[0]);
    } catch {
        return { kind: 'could-not-judge', reason: 'no-json' };
    }

    const shaped = foodnessWireSchema.safeParse(parsed);

    if (!shaped.success) {
        return { kind: 'could-not-judge', reason: 'bad-shape' };
    }

    const taxonomy = shaped.data.taxonomy.trim();
    const lowered = taxonomy.toLowerCase();

    if (shaped.data.isFood && NON_FOOD_TAXONOMY_MARKERS.some((marker) => lowered.includes(marker))) {
        return { kind: 'could-not-judge', reason: 'contradiction' };
    }

    return { kind: 'judged', isFood: shaped.data.isFood, taxonomy };
}
