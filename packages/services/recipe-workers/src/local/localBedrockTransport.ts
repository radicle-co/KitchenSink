/**
 * @module localBedrockTransport — the LLM leg's OFFLINE substitute, for `npm run local:up` (ADR-0024, ADR-0026).
 *
 * DESIGN PATTERN: **Fake (a working test double) behind the existing narrow Port**, dispatched by a
 * **Registry** keyed on the shipped prompts themselves.
 *
 * ## ⛔ WHY IT SITS AT `ConverseTransport` AND NOT ONE LAYER UP
 *
 * `localSupport.ts` records Bedrock as the one thing a local sandbox cannot emulate: *"LocalStack does not
 * emulate Bedrock inference; the LLM parse leg must call the real API or be stubbed at the port."* The port
 * it means is this one — `createBedrockConverseClient` is a PURE function of a {@link ConverseTransport},
 * documented as "the one seam the tests replace".
 *
 * Substituting higher — a fake `BedrockConverseClient`, or a fake `ParseEnginePort<'llm'>` — would be easier
 * and strictly worse. It would take the request assembly, `converseOutputSchema`, `firstTextIn`, the
 * `usage` reader, the `stopReason` rule, the error taxonomy AND the whole reserve-then-settle spine off the
 * local path. A local run would then pass for reasons the deployed path does not have, which is the one
 * outcome a local sandbox must never produce. Here, everything above the wire is the shipped code and the
 * only fabricated thing is the model's words.
 *
 * ## ⛔ THREE INDEPENDENT REASONS THIS CANNOT BE MISTAKEN FOR A REAL ANSWER
 *
 *  1. **It cannot serve a deployed stage.** {@link createLocalBedrockTransport} throws unless the stage is
 *     one of {@link LOCAL_ONLY_STAGES}. A deployed stage name is refused at CONSTRUCTION, before a caller
 *     can hold one.
 *  2. **It cannot reach AWS.** Nothing here imports an AWS SDK value — only a type, which is erased. Its own
 *     suite asserts that by reading this file's source, because "we observed no network call" is a weaker
 *     claim than "there is no client to make one with".
 *  3. **It cannot ride a deploy.** `esbuild.mjs` bundles the handler entry points, and
 *     `localWiringIsNotDeployed.test.ts` derives the reachable module set from those entry points and
 *     asserts that `src/local/**` is not in it.
 *
 * ## ⚠️ WHAT IT IS NOT
 *
 * It is not a parser and does not pretend to be one. It states a deterministic, deliberately mechanical
 * reading so the pipeline downstream of it — the validator loop, the comparator's merge, the cache, the
 * digest-guarded landing — is genuinely exercised locally. Judging PARSE QUALITY needs the real model; that
 * is `packages/tools/cookbook-import`'s comparison harness, not this.
 */
import type { ConverseTransport } from '@kitchensink/bedrock-client';

/**
 * The transport's own input, DERIVED from the port it implements rather than imported from the vendor.
 *
 * ⛔ This was `import type { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime'`, which
 * `turbo boundaries` correctly flagged: recipe-workers does not declare that package, so the import
 * resolved only by hoisting and would break the day it stopped. Declaring the vendor here would have been
 * the wrong repair anyway — this module exists precisely to sit BEHIND `@kitchensink/bedrock-client`'s
 * seam, and reaching past it to the vendor for a type is the coupling the seam refuses. Deriving from
 * `ConverseTransport` keeps one source of truth (ADR-0014: a consumer derives, it does not redeclare) and
 * adds no dependency.
 */
type ConverseCommandInput = Parameters<ConverseTransport>[0];
import { FOODNESS_SYSTEM_PROMPT } from '@kitchensink/recipe-core/parsing/foodness-prompt';
import { PARSE_SYSTEM_PROMPT } from '@kitchensink/recipe-core/parsing/parse-prompt';
import { buildVerificationPrompt } from '@kitchensink/recipe-core/resolution/verification-prompt';
import { namesNoFood } from '@kitchensink/recipe-import-core';

/**
 * The stages a local sandbox runs under.
 *
 * ⚠️ `dev` is the one `local:up` actually synthesises at (`local-sandbox/bin/adapters.ts` — `WebhooksStack`
 * validates the stage against the set this repo deploys and `local` fails it outright). `local` and `test`
 * are admitted because a harness may name itself either, and neither is a stage anything deploys under.
 */
export const LOCAL_ONLY_STAGES = ['dev', 'local', 'test'] as const;

/** What the fake needs. */
export interface LocalBedrockTransportOptions {
    /** The stage the caller is running as. Refused unless it is one of {@link LOCAL_ONLY_STAGES}. */
    readonly stage: string;
}

/**
 * The verification gate's system prompt, DERIVED by asking the shipped builder.
 *
 * ⛔ Not a literal. `verificationPrompt.ts` keeps its `SYSTEM_PROMPT` module-private, and a copy here would
 * be a second representation that stops matching the day the prompt is reworded — at which point this fake
 * silently stops recognising the measurement validator and the local run loses a leg with nothing failing.
 * The arguments are throwaway; only the system half is read.
 */
const VERIFICATION_SYSTEM_PROMPT = buildVerificationPrompt({
    sourceLine: 'x',
    candidateFoodName: 'x',
    quantityLow: null,
    quantityHigh: null,
    unit: null,
    aspects: ['quantity'],
}).system;

/** The line the parse prompts delimit. Kept in step with `parsePrompt.ts`'s tags by the suite. */
const DELIMITED_LINE = /<input>([\s\S]*)<\/input>/u;

/** A leading amount, a unit word, and the rest — the three-part shape. */
const MEASURE_UNIT_FOOD = /^\s*([\d]+(?:[./-][\d]+)?)\s+(\S+)\s+(\S[\s\S]*)$/u;

/** A leading amount and the rest — the two-part shape (`1 egg`), where the line states no unit. */
const MEASURE_FOOD = /^\s*([\d]+(?:[./-][\d]+)?)\s+(\S[\s\S]*)$/u;

/** One `Converse` answer, in the envelope the shipped client's zod accepts. */
function envelope(text: string): unknown {
    return {
        output: { message: { role: 'assistant', content: [{ text }] } },
        stopReason: 'end_turn',
        // ⚠️ REQUIRED, not decoration. The shipped client downgrades an answered call with unreadable usage
        // to `unusable` so the reservation stands, so a fake that omitted this would take the LLM leg out of
        // every local run while still looking like it answered. Deterministic, and derived from the answer
        // so a longer answer costs more — the settle arithmetic is then exercised with varying numbers.
        usage: {
            inputTokens: 1,
            outputTokens: [...text].length,
            totalTokens: 1 + [...text].length,
        },
    };
}

/** The system half of the call, or `''` when the input carries none. */
function systemPromptOf(input: ConverseCommandInput): string {
    const block = input.system?.[0];

    return typeof block === 'object' && block !== null && 'text' in block
        ? ((block as { text?: string }).text ?? '')
        : '';
}

/** The LAST user turn's text — the real line, after any few-shot turns the foodness leg prepends. */
function userMessageOf(input: ConverseCommandInput): string {
    const turns = input.messages ?? [];
    const last = turns.at(-1);
    const block = last?.content?.[0];

    return typeof block === 'object' && block !== null && 'text' in block
        ? ((block as { text?: string }).text ?? '')
        : '';
}

/** The ingredient line the parse prompts delimit, or the whole turn when it is not delimited. */
function lineOf(userMessage: string): string {
    return DELIMITED_LINE.exec(userMessage)?.[1]?.trim() ?? userMessage.trim();
}

/**
 * A deterministic, deliberately mechanical reading of one line, in the model's own answer shape.
 *
 * ⚠️ The measure is stated in the SOURCE'S OWN WORDS (`cups`, not the canonical `cup`), because that is what
 * `modelParseAnswerSchema` describes and what `normalizeParseAnswer` expects. Running the line through
 * `parseIngredientLine` instead would emit a CANONICALISED unit — a shape no model ever sends, so the local
 * path would exercise `normalizeParseAnswer` on input the deployed path never sees.
 *
 * @param line - The ingredient line, verbatim.
 * @returns The answer document, as JSON text. Pure.
 */
function parseAnswerFor(line: string): string {
    const comma = line.indexOf(',');
    const head = (comma < 0 ? line : line.slice(0, comma)).trim();
    const prep = comma < 0 ? '' : line.slice(comma + 1).trim();
    const three = MEASURE_UNIT_FOOD.exec(head);
    const two = three === null ? MEASURE_FOOD.exec(head) : null;
    const quantity = three?.[1] ?? two?.[1] ?? null;
    const unit = three?.[2] ?? null;
    const food = (three?.[3] ?? two?.[2] ?? head).trim();

    return JSON.stringify([
        {
            // ⚠️ An empty array, never `[""]` — `normalizeParseAnswer` drops a nameless food, and a line that
            // named none is a fact rather than a fault.
            food_items: food === '' ? [] : [food],
            measurement: quantity === null ? null : { quantity, unit, unit_type: null },
            preparations: prep === '' ? [] : [prep],
            equipment: [],
        },
    ]);
}

/**
 * The foodness verdict, from the repository's OWN not-a-food vocabulary.
 *
 * ⛔ Not "always true". A fake that passed everything would remove the validator's only effect from every
 * local run — the loop would never reject, `unparseable` would be unreachable, and `landingOf`'s
 * `not_a_food` branch would never be taken locally. `namesNoFood` is the vocabulary
 * `clauseSegmentation.ts` and `cookbook-import`'s accept gate already share, so this adds no second opinion.
 *
 * @param name - The candidate food name.
 * @returns The answer document, as JSON text. Pure.
 */
function foodnessAnswerFor(name: string): string {
    const isFood = !namesNoFood(name);

    // ⚠️ The taxonomy is free text by owner ruling ("never limit what it can be"), and `readFoodnessAnswer`
    // only consults it to catch a self-contradiction against `isFood: true` — so a marker naming this fake
    // is safe on the true branch and would be a contradiction on the false one.
    return JSON.stringify({ isFood, taxonomy: isFood ? 'local-offline-substitute' : 'equipment' });
}

/**
 * Thrown when the fake is asked a call it was never taught.
 *
 * ⛔ A refusal, never a fallback answer. A new gated leg must fail LOUDLY on the local path: a fake that
 * answered something plausible for an unknown prompt would report a working local pipeline for a leg it has
 * never seen, which is the class of failure this whole module exists to avoid.
 */
export class UnknownLocalPromptError extends Error {
    public constructor(systemPromptStart: string) {
        super(
            'the local Bedrock substitute was asked a call it does not recognise — teach it the new leg in ' +
                `localBedrockTransport.ts. System prompt began: ${JSON.stringify(systemPromptStart)}`,
        );
        this.name = 'UnknownLocalPromptError';
        Object.setPrototypeOf(this, UnknownLocalPromptError.prototype);
    }
}

/** Type guard for {@link UnknownLocalPromptError}. */
export function isUnknownLocalPromptError(error: unknown): error is UnknownLocalPromptError {
    return error instanceof UnknownLocalPromptError;
}

/**
 * Build the offline substitute for Bedrock's `Converse`.
 *
 * @param options - The stage, which must be a local one.
 * @returns A transport `createBedrockConverseClient` accepts, exactly as the real one is passed.
 * @throws When `stage` is not one of {@link LOCAL_ONLY_STAGES} — a deployed stage can never hold this.
 */
export function createLocalBedrockTransport(options: LocalBedrockTransportOptions): ConverseTransport {
    if (!(LOCAL_ONLY_STAGES as readonly string[]).includes(options.stage)) {
        throw new Error(
            `the local Bedrock substitute refuses stage '${options.stage}': it answers without calling a model, ` +
                `so it may only serve a local stage (${LOCAL_ONLY_STAGES.join(', ')}).`,
        );
    }

    return async (input: ConverseCommandInput): Promise<unknown> => {
        const system = systemPromptOf(input);
        const userMessage = userMessageOf(input);

        if (system === FOODNESS_SYSTEM_PROMPT) {
            return envelope(foodnessAnswerFor(lineOf(userMessage)));
        }

        if (system === VERIFICATION_SYSTEM_PROMPT) {
            // ⚠️ Always `agree`, and that is honest rather than lazy: judging a measurement needs the model
            // this fake replaces. The MEASUREMENT validator's disagree path is exercised by its own unit
            // suite; locally it passes so the parse under test reaches its landing.
            return envelope(JSON.stringify({ verdict: 'agree', certainty: 'high' }));
        }

        // ⛔ `startsWith`, and it covers BOTH parse legs: the retry prompt is the parse prompt plus a suffix
        // (`parseRetryPrompt.ts`), and both answer in the same shape. It comes LAST so the two exact
        // matches above can never be shadowed by a prefix rule.
        if (system.startsWith(PARSE_SYSTEM_PROMPT)) {
            return envelope(parseAnswerFor(lineOf(userMessage)));
        }

        throw new UnknownLocalPromptError(system.slice(0, 120));
    };
}
