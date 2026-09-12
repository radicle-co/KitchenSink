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
 * The `no-food` verdict sits inside the SAME carve-out and widens it by nothing: a parse that returned no
 * food at all gets back what IT produced (the measure it stated, clamped) and the checker's observation
 * that no food came with it. It deliberately does NOT assert that the line names one — on a heading or a
 * bare measure phrase that is false, and a model told a falsehood about its own input is a model invited
 * to invent an ingredient. Still nothing from the CRF, still nothing from any other engine.
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
      }
    | {
          readonly kind: 'no-food';
          /**
           * The measure the model's parse stated, or `null` when it stated none — the ONLY thing the model
           * produced for a line it named no food on.
           *
           * ⛔ A DISTINCT FIELD NAME from `measurement`'s `statedByModel`, deliberately. Sharing the name
           * would let this member render through the measurement arm with no type error — both would carry
           * the field the arm reads — and a foodless parse would be told its measure "does not match what
           * the line states", a verdict no validator reached. The rendering switch is the real guard; the
           * name is the second one.
           *
           * ⛔ `null` rather than a `'(none)'` sentinel: a placeholder token in a prompt is a small lie to
           * the model about its own output, and the lines that state no measure at all are exactly the
           * headings this must not push towards inventing a food.
           */
          readonly statedMeasure: string | null;
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

/**
 * Render one validator rejection as its own bullet.
 *
 * DESIGN PATTERN: Visitor, as an exhaustive `switch` over a discriminated union — the language satisfies
 * the intent, so there is no class machinery here.
 *
 * ⛔ A SWITCH RATHER THAN A TERNARY, and that is not style. This was a two-arm ternary on `kind`, which
 * meant every future member fell into the LAST arm and was rendered as somebody else's verdict. Adding
 * `no-food` to it produced exactly that: a foodless parse told its measure did not match the line. A
 * `satisfies never` default makes the next member a COMPILE error instead of a wrong sentence in a prompt.
 *
 * ⛔ WHAT MAY CROSS is unchanged by the new member (D5's carve-out): what the model ITSELF produced, plus
 * the checker's observation about it. The `no-food` bullet deliberately does NOT assert that the line names
 * a food — on a heading or a stray measure phrase that claim is false, and telling a model a falsehood
 * about its own input is how a retry earns a fabricated ingredient.
 *
 * @param failure - One rejection.
 * @returns Its bullet, every crossing string clamped. Pure.
 */
function renderFailure(failure: RetryFailure): string {
    switch (failure.kind) {
        case 'not-a-food':
            return `- the food name "${clamp(failure.name)}" is not a food (${clamp(failure.taxonomy)})`;
        case 'measurement':
            return `- the measure "${clamp(failure.statedByModel)}" does not match what the line states`;
        case 'no-food':
            return failure.statedMeasure === null
                ? '- no food name was returned at all'
                : `- no food name was returned; the measure read was "${clamp(failure.statedMeasure)}"`;
        default:
            // ⛔ EXHAUSTIVENESS, checked by the compiler — see this function's header.
            return failure satisfies never;
    }
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
    const rendered = failures.map(renderFailure).join('\n');
    const systemPrompt = PARSE_SYSTEM_PROMPT + PARSE_RETRY_SUFFIX_TEMPLATE.replace('{failures}', rendered);
    const userMessage = `${OPEN_TAG}${line}${CLOSE_TAG}`;
    const observedChars = [...systemPrompt].length + [...userMessage].length;

    if (observedChars > MAX_PARSE_PROMPT_CHARS) {
        throw new ParseRetryPromptTooLargeError(observedChars);
    }

    return { systemPrompt, userMessage };
}
