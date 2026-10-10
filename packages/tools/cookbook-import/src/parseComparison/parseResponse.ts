/**
 * THE CONTRACT CENSUS — what one model's answer WAS, before anything asks whether it was right.
 *
 * DESIGN PATTERN: **discriminated-union outcome** (the same shape as `RecipeCandidateOutcome`), so a
 * response that could not be read is never mistaken for a parse with empty fields, and an exhaustive
 * `switch` over the union is the census.
 *
 * ## ⛔ WHY THIS IS THE HEADLINE MEASUREMENT AND NOT A DETAIL
 *
 * The consumer of this answer is a program, and the reader it would go through takes WHOLE DOCUMENTS: a
 * response that is not a bare JSON document of the declared shape is a refusal, however good the parse
 * inside it is. The previous run measured 561 unreadable responses from one model (13.2%) — a stray `]`,
 * a field opened with `"` and closed with `'` — and every one of those was a line that got no answer. A
 * model's contract compliance therefore bounds everything else it could be good at.
 *
 * ## ⚠️ THE FIVE BUCKETS ARE NOT THE SAME FAILURE, WHICH IS WHY THEY ARE COUNTED APART
 *
 * | bucket          | what it means                            | is it fixable outside the model?              |
 * | --------------- | ---------------------------------------- | --------------------------------------------- |
 * | `valid`         | a bare document of the declared shape    | —                                              |
 * | `proseWrapper`  | the right JSON inside markdown or prose  | YES — a reader could unwrap it, at a cost      |
 * | `wrongShape`    | JSON, but not the shape asked for        | sometimes — depends which field is wrong       |
 * | `malformedJson` | not JSON at all, or JSON that will not parse | NO — the content is gone                   |
 * | `truncated`     | the answer was cut off at `maxTokens`    | YES — raise the cap, at a cost                 |
 *
 * Folding `proseWrapper` into `malformedJson` would hide the one failure a three-line change to the reader
 * recovers; folding it into `valid` would report a compliance the shipped reader does not have.
 */
import { z } from 'zod';

/**
 * The declared answer shape, spelled once.
 *
 * ⛔ `strictObject`, not `object`. The prompt names the whole document; a response carrying an extra field
 * is not the document that was asked for, and counting it as compliant would report a contract the reader
 * does not enforce. This mirrors §15.5.2's default for a mutating body, for the same reason: an unexpected
 * key is a signal, not noise.
 */
export const modelParseSchema = z.strictObject({
    measure: z.string(),
    foods: z.array(z.strictObject({ name: z.string(), prep: z.string().nullable() })),
});

export type ModelParse = z.infer<typeof modelParseSchema>;

/**
 * A reading in the ONE vocabulary every figure in a run is computed in.
 *
 * ⛔ v1's shape PLUS the single thing an arm may state that v1 structurally cannot. The bake-off's candidate
 * prompts declare different documents — v2 adds `equipment`, v3 replaces the measure phrase with five
 * slots — and each arm's Adapter (`promptVariant.ts`) projects its own document down to THIS, so the
 * contract census, the CRF comparator, the non-food census and the cost arithmetic are one implementation
 * rather than three. Three comparators would let the arms disagree about what "the same" means, and the
 * report would be internally inconsistent with nothing to point at.
 *
 * ⚠️ `ModelParse` is assignable to this, because the added member is optional. That is what keeps every
 * pre-existing caller and test compiling unchanged while the new dimension is threaded through.
 */
export interface VariantParse extends ModelParse {
    /**
     * The unit the arm's answer STATED, when the arm has a unit slot at all.
     *
     * ⛔ `undefined` means "this arm has no unit slot — derive the unit from the measure phrase, as v1 and
     * v2 do". The empty string means "this arm HAS a unit slot and answered that the line states none",
     * which is a reading and is taken at face value. See `promptVariant.ts`'s `statedUnitOf`: collapsing the
     * two would let a model-stated arm silently fall back to the derived one, and no figure downstream could
     * then say which mechanism produced a unit.
     */
    readonly statedUnit?: string;
}

/**
 * How one arm judges a JSON document against the shape ITS prompt declared, and projects it.
 *
 * DESIGN PATTERN: **injected Strategy.** {@link classifyParseResponse} owns the ORDER in which a response is
 * judged — the whole of its measurement decision — and knows nothing about which document was asked for. An
 * arm supplies only the shape verdict, so a candidate prompt cannot accidentally change what "truncated" or
 * "wrapped in prose" means and make its column incomparable.
 */
export type AnswerReader = (
    value: unknown,
) => { readonly ok: true; readonly parse: VariantParse } | { readonly ok: false; readonly detail: string };

/**
 * The default reader: the SHIPPED answer shape.
 *
 * ⚠️ Defaulted rather than required so every pre-existing caller keeps measuring exactly what it measured
 * before this parameter existed. A required parameter would have made the baseline arm's numbers depend on
 * a call site edit, which is the one thing a baseline may not do.
 */
export const readModelParseAnswer: AnswerReader = (value) => {
    const parsed = modelParseSchema.safeParse(value);

    return parsed.success
        ? { ok: true, parse: parsed.data }
        : {
              ok: false,
              detail: parsed.error.issues
                  .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
                  .join('; '),
          };
};

/** How a response failed to be a bare document, when the JSON inside it was still findable. */
export type ProseWrapperKind = 'codeFence' | 'proseText';

/** What one response WAS. */
export type ParseResponseOutcome =
    | { readonly kind: 'valid'; readonly parse: VariantParse }
    | { readonly kind: 'truncated' }
    | {
          readonly kind: 'proseWrapper';
          readonly wrapper: ProseWrapperKind;
          /** The parse recovered from inside the wrapper, or `undefined` when the inside was unreadable too. */
          readonly parse: VariantParse | undefined;
      }
    | { readonly kind: 'wrongShape'; readonly detail: string }
    | { readonly kind: 'malformedJson'; readonly detail: string };

/** Every bucket name, for a census that cannot silently omit one. */
export const PARSE_RESPONSE_KINDS = ['valid', 'truncated', 'proseWrapper', 'wrongShape', 'malformedJson'] as const;

export type ParseResponseKind = (typeof PARSE_RESPONSE_KINDS)[number];

/** A markdown fence, with or without a language tag. */
const CODE_FENCE = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?\s*```$/;

/** At least one letter — the difference between prose around a document and a stray delimiter. */
const CARRIES_A_WORD = /\p{L}/u;

/**
 * Classify one model response.
 *
 * ⚠️ The order of the rules is the definition, not an implementation detail:
 *
 *  1. `max_tokens` decides `truncated` BEFORE the text is looked at. A cut-off answer that happens to be
 *     parseable is still an answer the model did not finish, and reading it would credit the model for a
 *     completeness it never claimed.
 *  2. A document that `JSON.parse` accepts is judged on its SHAPE — including a JSON array, which is
 *     `wrongShape` rather than malformed, because the content is intact and only the shape is wrong.
 *  3. A markdown fence is a wrapper by construction, whatever is inside it.
 *  4. Otherwise: if a JSON object can be recovered from between the first `{` and the last `}` AND the
 *     material outside it contains a letter, the wrapper was prose. Material with no letter — a stray `]`,
 *     a trailing comma — is a MALFORMED document, not a wrapped one: nothing unwrapped it, the model
 *     simply produced broken JSON.
 *
 * @param text - The first assistant text block, verbatim.
 * @param stopReason - The response's stop reason, passed through as Bedrock gave it.
 * @param readAnswer - How to judge a JSON document against the shape the arm's prompt declared. Defaults to
 *   the shipped shape, so a caller that predates the bake-off measures exactly what it always did.
 * @returns What the response was. Pure.
 */
export function classifyParseResponse(
    text: string,
    stopReason: string,
    readAnswer: AnswerReader = readModelParseAnswer,
): ParseResponseOutcome {
    if (stopReason === 'max_tokens') {
        return { kind: 'truncated' };
    }

    const trimmed = text.trim();

    if (trimmed.length === 0) {
        return { kind: 'malformedJson', detail: 'empty response' };
    }

    const bare = readJson(trimmed);

    if (bare.ok) {
        return judgeShape(bare.value, readAnswer);
    }

    const fenced = CODE_FENCE.exec(trimmed);

    if (fenced !== null) {
        const inner = readJson((fenced[1] ?? '').trim());

        return { kind: 'proseWrapper', wrapper: 'codeFence', parse: readParse(inner, readAnswer) };
    }

    const open = trimmed.indexOf('{');
    const close = trimmed.lastIndexOf('}');

    if (open !== -1 && close > open) {
        const span = readJson(trimmed.slice(open, close + 1));
        const outside = trimmed.slice(0, open) + trimmed.slice(close + 1);

        if (span.ok && CARRIES_A_WORD.test(outside)) {
            return { kind: 'proseWrapper', wrapper: 'proseText', parse: readParse(span, readAnswer) };
        }
    }

    return { kind: 'malformedJson', detail: firstLine(trimmed) };
}

/**
 * The conformant parse a non-compliant response still contains, if any.
 *
 * ⛔ A DIFFERENT QUESTION FROM THE BUCKET, and it must stay one. `classifyParseResponse` answers "what was
 * this response", which is a claim about the model; this answers "could a reader get the answer out anyway",
 * which is a claim about what a change to OUR code would buy. They diverge: a perfect document followed by
 * a stray `]` is `malformedJson` — correctly, nothing wrapped it, the model emitted broken JSON — and its
 * content is nonetheless sitting right there. Deriving recoverability from the bucket under-reported
 * `complianceAfterUnwrapRate` for exactly those responses.
 *
 * ⚠️ This is the deliberate brace-scan that `verification/verdict.ts` forbids for a VERDICT, and the reason
 * it is safe here is narrow: what it returns decides a research statistic and a boolean in a report. Nothing
 * extracted from prose is ever published, fed to the CRF comparison, or put back into a prompt. Do not reuse
 * this function anywhere a value reaches a user.
 *
 * @param text - The response verbatim.
 * @param readAnswer - The arm's shape verdict. Defaults to the shipped shape.
 * @returns The conformant parse inside it, or `undefined`. Pure.
 */
export function recoverableParse(
    text: string,
    readAnswer: AnswerReader = readModelParseAnswer,
): VariantParse | undefined {
    const trimmed = text.trim();
    const fenced = CODE_FENCE.exec(trimmed);
    const inner = fenced === null ? trimmed : (fenced[1] ?? '').trim();
    const direct = readParse(readJson(inner), readAnswer);

    if (direct !== undefined) {
        return direct;
    }

    const open = inner.indexOf('{');
    const close = inner.lastIndexOf('}');

    return open !== -1 && close > open ? readParse(readJson(inner.slice(open, close + 1)), readAnswer) : undefined;
}

type JsonRead = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

function readJson(candidate: string): JsonRead {
    try {
        return { ok: true, value: JSON.parse(candidate) as unknown };
    } catch {
        return { ok: false };
    }
}

function readParse(read: JsonRead, readAnswer: AnswerReader): VariantParse | undefined {
    if (!read.ok) {
        return undefined;
    }

    const answer = readAnswer(read.value);

    return answer.ok ? answer.parse : undefined;
}

function judgeShape(value: unknown, readAnswer: AnswerReader): ParseResponseOutcome {
    const answer = readAnswer(value);

    return answer.ok ? { kind: 'valid', parse: answer.parse } : { kind: 'wrongShape', detail: answer.detail };
}

/** Enough of an unreadable response to recognise it in a report, without pasting a whole log line. */
function firstLine(text: string): string {
    return (text.split('\n')[0] ?? '').slice(0, 120);
}
