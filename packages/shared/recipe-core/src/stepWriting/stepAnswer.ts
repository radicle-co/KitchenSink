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
 * - `overCap`: more steps than the caller's cap;
 * - `unsafeText`: a step holding a link, markup or any character outside plain recipe prose (see `PLAIN_PROSE`).
 *
 * This reader checks the SHAPE and the CHARACTERS of the text. It cannot check that the text is true to the recipe:
 * the fact check that follows (slice A4) does, and refuses any text that cannot be traced to the facts sheet. Every
 * number, temperature, time, equipment word and ingredient name in the written steps must appear on the sheet, so a
 * name or figure that was not a fact is refused there.
 *
 * Whether each `covers` index points at a real source step, and which source steps must be covered, needs the source
 * recipe, which is not in the answer. The rewrite step that holds both checks it.
 */
import { z } from 'zod';

/** The largest `cap` a caller may pass. A bound far above any real recipe that still catches a typo. */
export const MAX_ANSWER_CAP = 1_000;

/**
 * What a written step may contain: letters, marks, numbers, spaces and the punctuation of plain recipe prose.
 * No angle or square brackets, braces, backslash, backtick, `@`, `*`, `_`, `#`, `|`, `~`, `$`, `=`, `+`, emoji or
 * control characters, and no line break.
 */
const PLAIN_PROSE = /^[\p{L}\p{M}\p{N} .,;:!?'’"“”()\-–—/%°&。、，；：！？（）「」]+$/u;

/** What reads as an address even in plain characters: a `//`, a `www.`, or a dotted domain such as `a.example`. */
const ADDRESS_LIKE = /\/\/|www\.|\p{L}\.\p{L}{2,}/iu;

/** The most text one rewritten step may hold (contract `rewrittenSteps.api.md`). */
export const MAX_REWRITTEN_STEP_CHARS = 2_000;

const stepSchema = z.strictObject({
    text: z.string().refine((text) => text.trim() !== '' && [...text].length <= MAX_REWRITTEN_STEP_CHARS),
    covers: z.array(z.number().int().nonnegative()).min(1),
});

const answerSchema = z.strictObject({ steps: z.array(stepSchema).min(1) });

/** One step of the writer's result. */
export type RewrittenStep = z.infer<typeof stepSchema>;

/** Why an answer was refused. */
export type StepAnswerRefusal = 'unreadable' | 'outsideList' | 'overCap' | 'unsafeText';

/** A readable answer, or the reason it was refused. */
export type StepAnswer =
    { readonly ok: true; readonly steps: readonly RewrittenStep[] } | { readonly refused: StepAnswerRefusal };

/**
 * Read the writer's answer.
 *
 * @param text - The model's reply, verbatim.
 * @param cap - The most steps the caller accepts: an integer from 1 to {@link MAX_ANSWER_CAP}.
 * @returns The steps, or the refusal. Pure.
 * @throws {RangeError} When `cap` is not an integer from 1 to {@link MAX_ANSWER_CAP}.
 */
export function parseStepAnswer(text: string, cap: number): StepAnswer {
    if (!Number.isInteger(cap) || cap < 1 || cap > MAX_ANSWER_CAP) {
        throw new RangeError(`cap must be an integer from 1 to ${MAX_ANSWER_CAP}`);
    }

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

    if (parsed.data.steps.some(({ text: step }) => !PLAIN_PROSE.test(step) || ADDRESS_LIKE.test(step))) {
        return { refused: 'unsafeText' };
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
