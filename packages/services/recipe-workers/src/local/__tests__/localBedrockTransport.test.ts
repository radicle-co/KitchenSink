/**
 * The OFFLINE substitute for the LLM leg — asserted through the REAL `createBedrockConverseClient`.
 *
 * ⛔ THE CLIENT IS NOT MOCKED HERE, AND THAT IS THE POINT. `localSupport.ts` says of Bedrock that "the LLM
 * parse leg must call the real API or be stubbed at the port"; the port it means is
 * {@link ConverseTransport}, the one seam `createBedrockConverseClient` is a pure function of. Substituting
 * one layer higher — a fake `BedrockConverseClient` — would take the envelope schema, the `usage` reader,
 * the `stopReason` rule and the whole error taxonomy off the local path, and a local run would then pass for
 * reasons the deployed path does not have.
 *
 * ⚠️ Every prompt below is built by the SHIPPED builder, never by a literal. The dispatch this fake performs
 * is keyed on the system prompt, so a test that typed its own string would assert the fake against itself
 * and would keep passing on the day a prompt is reworded — exactly when the fake stops answering.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createBedrockConverseClient } from '@kitchensink/bedrock-client';
import { buildFoodnessPrompt, FOODNESS_MAX_OUTPUT_TOKENS } from '@kitchensink/recipe-core/parsing/foodness-prompt';
import { readFoodnessAnswer } from '@kitchensink/recipe-core/parsing/foodness-answer';
import { buildParsePrompt, PARSE_MAX_OUTPUT_TOKENS } from '@kitchensink/recipe-core/parsing/parse-prompt';
import { buildParseRetryPrompt } from '@kitchensink/recipe-core/parsing/parse-retry-prompt';
import { modelParseAnswerSchema, normalizeParseAnswer } from '@kitchensink/recipe-core/parsing/parse-answer';
import { buildVerificationPrompt } from '@kitchensink/recipe-core/resolution/verification-prompt';
import { readVerdict } from '@kitchensink/recipe-core/resolution/verification-verdict';

import { createLocalBedrockTransport, LOCAL_ONLY_STAGES } from '../localBedrockTransport.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** A client over the fake, exactly as the local entry builds it. */
const clientFor = (stage = 'dev') => createBedrockConverseClient(createLocalBedrockTransport({ stage }));

describe('the local Bedrock substitute', () => {
    describe('⛔ it cannot be pointed at a deployed stage', () => {
        it.each(['prod', 'sandbox', 'pr-73', 'staging'])('refuses to construct for %s', (stage) => {
            expect(() => createLocalBedrockTransport({ stage })).toThrow(/local/iu);
        });

        it.each([...LOCAL_ONLY_STAGES])('constructs for the local stage %s', (stage) => {
            expect(() => createLocalBedrockTransport({ stage })).not.toThrow();
        });
    });

    it('⛔ reaches no network at all — it imports no AWS SDK value', () => {
        // A structural claim a behavioural test cannot make: the fake must be incapable of calling AWS, not
        // merely observed not to. A value import of the SDK would be the one way that changes.
        const source = readFileSync(path.join(MODULE_DIR, '..', 'localBedrockTransport.ts'), 'utf8');
        const awsImports = [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'(@aws-sdk\/[^']+)'/gmu)];

        expect(awsImports.length, 'the fake should import AWS types only, if anything').toBeGreaterThan(0);
        expect(
            awsImports.filter((match) => match[1] === undefined).map((match) => match[2]),
            'a VALUE import of an AWS SDK client would give the offline fake a way to reach AWS',
        ).toEqual([]);
    });

    it('answers the parse leg in the shape the shipped reader accepts', async () => {
        const prompt = buildParsePrompt('2 cups flour, sifted');
        const outcome = await clientFor().converse({
            invocationId: 'amazon.nova-2-lite-v1:0',
            systemPrompt: prompt.systemPrompt,
            userMessage: prompt.userMessage,
            maxOutputTokens: PARSE_MAX_OUTPUT_TOKENS,
            temperature: 0,
        });

        expect(outcome.kind).toBe('answered');

        if (outcome.kind !== 'answered') {
            return;
        }

        // ⛔ Read by the SHIPPED schema, not by `JSON.parse` — the fake's whole job is to be readable by the
        // code the deployed leg uses, and `strictObject` refuses an extra key.
        const answer = modelParseAnswerSchema.safeParse(JSON.parse(outcome.text));

        expect(answer.success, `the fake produced text the shipped schema refuses: ${outcome.text}`).toBe(true);

        const normalized = normalizeParseAnswer(answer.data ?? []);

        expect(normalized.foods.map((food) => food.name)).toEqual(['flour']);
        expect(normalized.foods[0]?.prep).toBe('sifted');
        expect(normalized.statedQuantity).toBe('2');
        expect(normalized.statedUnit).toBe('cups');
    });

    it('answers the RETRY leg too — its system prompt is the parse prompt plus a suffix', async () => {
        const prompt = buildParseRetryPrompt('1 pinch salt', [{ kind: 'measurement', statedByModel: '1 pinch' }]);

        expect(prompt.systemPrompt).not.toBe(buildParsePrompt('1 pinch salt').systemPrompt);

        const outcome = await clientFor().converse({
            invocationId: 'amazon.nova-2-lite-v1:0',
            systemPrompt: prompt.systemPrompt,
            userMessage: prompt.userMessage,
            maxOutputTokens: PARSE_MAX_OUTPUT_TOKENS,
        });

        expect(outcome.kind).toBe('answered');
        expect(modelParseAnswerSchema.safeParse(JSON.parse((outcome as { text: string }).text)).success).toBe(true);
    });

    it('judges foodness from the repository’s OWN not-a-food vocabulary, both ways', async () => {
        const judge = async (name: string) => {
            const prompt = buildFoodnessPrompt(name);
            const outcome = await clientFor().converse({
                invocationId: 'amazon.nova-micro-v1:0',
                systemPrompt: prompt.systemPrompt,
                userMessage: prompt.userMessage,
                fewShotTurns: prompt.fewShotTurns,
                maxOutputTokens: FOODNESS_MAX_OUTPUT_TOKENS,
                temperature: prompt.temperature,
            });

            return outcome.kind === 'answered'
                ? readFoodnessAnswer(outcome.text, outcome.stopReason)
                : { kind: 'could-not-judge' as const, reason: 'no-json' as const };
        };

        // ⛔ BOTH directions. A fake that answered `isFood: true` unconditionally would pass a single
        // positive assertion while removing the validator's only effect from every local run.
        expect(await judge('flour')).toEqual({ kind: 'judged', isFood: true, taxonomy: expect.any(String) });
        expect(await judge('frying-pan')).toMatchObject({ kind: 'judged', isFood: false });
    });

    it('answers the measurement validator with a readable verdict', async () => {
        const prompt = buildVerificationPrompt({
            sourceLine: '2 cups flour',
            candidateFoodName: 'flour',
            quantityLow: 2,
            quantityHigh: null,
            unit: 'cup',
            aspects: ['quantity'],
        });
        const outcome = await clientFor().converse({
            invocationId: 'amazon.nova-2-lite-v1:0',
            systemPrompt: prompt.system,
            userMessage: prompt.user,
            maxOutputTokens: 64,
            temperature: 0,
        });

        expect(outcome.kind).toBe('answered');

        const reading = readVerdict((outcome as { text: string }).text, (outcome as { stopReason: string }).stopReason);

        expect(reading.kind).toBe('read');
        expect(reading.kind === 'read' ? reading.outcome.verdict : undefined).toBe('agree');
    });

    it('⛔ REFUSES a system prompt it does not recognise, rather than inventing an answer', async () => {
        // A new gated leg must fail loudly on the local path. A fake that fell back to "answer something"
        // would report a working local pipeline for a leg it has never been taught.
        await expect(
            clientFor().converse({
                invocationId: 'amazon.nova-2-lite-v1:0',
                systemPrompt: 'You are a leg nobody taught this fake about.',
                userMessage: '<input>x</input>',
                maxOutputTokens: 10,
            }),
        ).rejects.toThrow();
    });

    it('is deterministic — the same call twice is byte-identical', async () => {
        const prompt = buildParsePrompt('3 tablespoons butter');
        const call = async () =>
            clientFor().converse({
                invocationId: 'amazon.nova-2-lite-v1:0',
                systemPrompt: prompt.systemPrompt,
                userMessage: prompt.userMessage,
                maxOutputTokens: PARSE_MAX_OUTPUT_TOKENS,
            });

        expect(await call()).toEqual(await call());
    });

    it('reports usage, so the reserve-then-settle path is exercised locally', async () => {
        const prompt = buildParsePrompt('1 egg');
        const outcome = await clientFor().converse({
            invocationId: 'amazon.nova-2-lite-v1:0',
            systemPrompt: prompt.systemPrompt,
            userMessage: prompt.userMessage,
            maxOutputTokens: PARSE_MAX_OUTPUT_TOKENS,
        });

        // ⚠️ `usage: undefined` is a DIFFERENT outcome in the shipped client — it downgrades an answered call
        // to `unusable` so the reservation stands. A fake that omitted usage would silently take the LLM leg
        // out of every local run while still looking like it answered.
        expect(outcome.kind).toBe('answered');
        expect((outcome as { usage: { totalTokens: number } }).usage.totalTokens).toBeGreaterThan(0);
    });
});
