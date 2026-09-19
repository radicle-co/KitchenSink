/**
 * THE PARSE RETRY PROMPT (plan U7, KTD-D / origin D5) — the conscious, NARROW carve-out from the
 * poisoning rule.
 *
 * ## ⛔ WHAT MAY CROSS, and what may not
 *
 * D5's ruling: the foodness verdict ("not a food — it is an <equipment|action|…>") is NEW information a
 * parser retry can use, so feeding it back is a deliberate carve-out from the poisoning rule — which
 * "remains absolute for cross-engine contamination (the CRF never sees anything)". What crosses is the
 * CATEGORIZED VERDICT: the rejected name and its taxonomy, each length-clamped
 * ({@link MAX_RETRY_CONTEXT_CHARS}) because the taxonomy is a free-form string by owner ruling (open
 * taxonomy) and containment is therefore a CLAMP plus this builder's own pin — never the validator's raw
 * completion, and never anything from the CRF.
 *
 * ## ⛔ THE BASE TASK IS `PARSE_SYSTEM_PROMPT`, VERBATIM
 *
 * The measured parse task is not reworded — the retry APPENDS a context section. The static suffix
 * template is pinned by SHA-256 exactly as the base prompt is: the wording of the feedback framing is
 * part of what any future retry-rate figure is denominated in.
 *
 * ## Why a separate builder rather than a parameter on `buildParsePrompt`
 *
 * `buildParsePrompt`'s ONE-argument signature is ADR-0026's independence guarantee, pinned in invariant
 * position precisely so a second parameter — required or optional — is a build failure. The retry is a
 * different call with a different contract, so it gets its own builder with its own `Exact` pin
 * (`[string, failures]`), and the first-attempt path physically cannot acquire a context argument.
 */
import { MAX_PARSE_PROMPT_CHARS, PARSE_SYSTEM_PROMPT } from './parsePrompt.js';

/** One validator rejection, as the retry context carries it — a union, one member per validator. */
export type RetryFailure =
    | {
          readonly kind: 'not-a-food';
          /** The food name the foodness validator rejected. */
          readonly name: string;
          /** The validator's open-taxonomy category ("equipment", "verb", …). Clamped on the way in. */
          readonly taxonomy: string;
      }
    | {
          readonly kind: 'measurement';
          /** The measure the model's parse stated — what the gate's quantity check disagreed with. */
          readonly statedByModel: string;
      };

/** The clamp applied to EACH crossing string — the owner-ruled containment for the open taxonomy. */
export const MAX_RETRY_CONTEXT_CHARS = 40;

/**
 * The static suffix template, byte for byte. `{failures}` is the one substitution point.
 *
 * SHA-256: {@link PARSE_RETRY_SUFFIX_SHA256}.
 */
export const PARSE_RETRY_SUFFIX_TEMPLATE = [
    '',
    '## Retry Context',
    'Your previous parse of this line was rejected by a validator:',
    '{failures}',
    'Parse the line again, correcting these errors. Re-read the line and decide what it',
    'actually states under the rules above.',
].join('\n');

/** SHA-256 of {@link PARSE_RETRY_SUFFIX_TEMPLATE}. A reword is a new experiment. */
export const PARSE_RETRY_SUFFIX_SHA256 = '8e1fc04137273fb8b8b32fea2f444b2ba00a8f4c16c57323f2e476f4207c71f0';

/** Clamp one crossing string to the containment bound, in code points. */
function clamp(value: string): string {
    const points = [...value];

    return points.length <= MAX_RETRY_CONTEXT_CHARS ? value : points.slice(0, MAX_RETRY_CONTEXT_CHARS).join('');
}

/** The delimiters, matching `buildParsePrompt`'s exactly. */
const OPEN_TAG = '<input>';
const CLOSE_TAG = '</input>';

/** The complete retry call. */
export interface ParseRetryPrompt {
    readonly systemPrompt: string;
    readonly userMessage: string;
}

/** Thrown when the assembled retry prompt exceeds the parse leg's own cap. */
export class ParseRetryPromptTooLargeError extends Error {
    public readonly observedChars: number;

    public constructor(observedChars: number) {
        super(`retry prompt is ${String(observedChars)} code points; the cap is ${String(MAX_PARSE_PROMPT_CHARS)}`);
        this.observedChars = observedChars;
        Object.setPrototypeOf(this, ParseRetryPromptTooLargeError.prototype);
    }
}

/**
 * Build one retry call.
 *
 * @param line - The source line, byte-identical to the first attempt's.
 * @param failures - The validator rejections feeding this retry, clamped on the way in.
 * @returns The complete call.
 * @throws {ParseRetryPromptTooLargeError} when the assembled prompt exceeds the parse cap.
 */
export function buildParseRetryPrompt(line: string, failures: readonly RetryFailure[]): ParseRetryPrompt {
    const rendered = failures
        .map((failure) =>
            failure.kind === 'not-a-food'
                ? `- the food name "${clamp(failure.name)}" is not a food (${clamp(failure.taxonomy)})`
                : `- the measure "${clamp(failure.statedByModel)}" does not match what the line states`,
        )
        .join('\n');
    const systemPrompt = PARSE_SYSTEM_PROMPT + PARSE_RETRY_SUFFIX_TEMPLATE.replace('{failures}', rendered);
    const userMessage = `${OPEN_TAG}${line}${CLOSE_TAG}`;
    const observedChars = [...systemPrompt].length + [...userMessage].length;

    if (observedChars > MAX_PARSE_PROMPT_CHARS) {
        throw new ParseRetryPromptTooLargeError(observedChars);
    }

    return { systemPrompt, userMessage };
}
