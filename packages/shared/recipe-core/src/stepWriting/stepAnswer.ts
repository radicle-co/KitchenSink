/**
 * The writer's answer, read as data (spec 027 FR-046).
 *
 * DESIGN PATTERN: parse, don't validate, at a third-party boundary. A zod `strictObject` describes the one
 * document the prompt asked for. Anything else is refused and nothing is guessed, repaired or trimmed to fit.
 *
 * The three refusals are separate so the caller can count them (FR-066):
 * - `unreadable`: not JSON, or not the shape asked for;
 * - `outsideList`: readable parts that are not the step list, such as prose around the JSON, a code fence, or a
 *   field the prompt never asked for;
 * - `overCap`: more steps than the caller's cap.
 *
 * Whether each `covers` index points at a real source step, and whether every source step with text is covered, needs
 * the source step count, which is not in the answer. The caller holding the sheet checks that.
 */
import { z } from 'zod';

/** The most text one rewritten step may hold (contract `rewrittenSteps.api.md`). */
export const MAX_REWRITTEN_STEP_CHARS = 2_000;

/** The most steps a result may hold (research R12, to confirm on the evaluation set). */
export const MAX_REWRITTEN_STEPS = 80;

const stepSchema = z.strictObject({
    text: z.string().refine((text) => text.trim() !== '' && text.length <= MAX_REWRITTEN_STEP_CHARS),
    covers: z.array(z.number().int().nonnegative()),
});

const answerSchema = z.strictObject({ steps: z.array(stepSchema).min(1) });

/** One step of the writer's result. */
export type RewrittenStep = z.infer<typeof stepSchema>;

/** Why an answer was refused. */
export type StepAnswerRefusal = 'unreadable' | 'outsideList' | 'overCap';

/** A readable answer, or the reason it was refused. */
export type StepAnswer =
    { readonly ok: true; readonly steps: readonly RewrittenStep[] } | { readonly refused: StepAnswerRefusal };

/**
 * Read the writer's answer.
 *
 * @param text - The model's reply, verbatim.
 * @param cap - The most steps the caller accepts.
 * @returns The steps, or the refusal. Pure.
 */
export function parseStepAnswer(text: string, cap: number): StepAnswer {
    let json: unknown;

    try {
        json = JSON.parse(text);
    } catch {
        // Prose or a code fence around an otherwise valid answer is text outside the list, not an unreadable one.
        return { refused: looksLikeWrappedAnswer(text) ? 'outsideList' : 'unreadable' };
    }

    const parsed = answerSchema.safeParse(json);

    if (!parsed.success) {
        const extraKey = parsed.error.issues.some((issue) => issue.code === 'unrecognized_keys');
        const otherFault = parsed.error.issues.some((issue) => issue.code !== 'unrecognized_keys');

        // A field we did not ask for beside an otherwise valid answer. Any other fault wins: it is unreadable.
        return { refused: extraKey && !otherFault ? 'outsideList' : 'unreadable' };
    }

    if (parsed.data.steps.length > cap) {
        return { refused: 'overCap' };
    }

    return { ok: true, steps: parsed.data.steps };
}

/**
 * Whether text that is not JSON holds a valid answer inside it.
 *
 * @param text - The reply that failed `JSON.parse`.
 * @returns True when the first `{` to the last `}` is a valid answer. Pure.
 */
function looksLikeWrappedAnswer(text: string): boolean {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');

    if (start === -1 || end <= start) {
        return false;
    }

    try {
        return answerSchema.safeParse(JSON.parse(text.slice(start, end + 1))).success;
    } catch {
        return false;
    }
}
