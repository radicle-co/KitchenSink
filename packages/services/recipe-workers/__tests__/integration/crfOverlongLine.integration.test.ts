/**
 * A PASTE LINE LONGER THAN THE CRF ENGINE ACCEPTS LANDS FROM THE LLM LEG ALONE (audit finding 5).
 *
 * The paste limit (1,000 characters) is looser than the engine's own (512). The Python handler refuses a line
 * over its limit, the refusal became `CrfEngineUnavailableError('unreachable')`, and the message retried until
 * its allowance ran out. Now the adapter never sends such a line and answers absence for it (ADR-0026 §3), so
 * the pipeline lands it as `single-engine llm`.
 *
 * Mocked: the Lambda client and the LLM leg. Real: the CRF adapter, `runParsePipeline` and the comparator.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import { MAX_LINE_CHARS } from '@kitchensink/ingredient-parser';
import {
    NO_CACHE,
    NO_CORRECTIONS,
    runParsePipeline,
    type ParsedLine,
    type ParseEnginePort,
} from '@kitchensink/recipe-import-core';

import { createCrfInvokeEngine } from '../../src/parsing/crfInvoke.js';

const LONG_LINE = `2 cups flour ${'x'.repeat(MAX_LINE_CHARS + 88)}`;

const LLM_READING: ParsedLine = {
    raw: LONG_LINE,
    statedMeasure: '2 cups',
    quantity: { kind: 'exact', value: 2 },
    unit: 'cup',
    foods: [{ name: 'flour', prep: null }],
    reviewReasons: [],
    provenance: { statedMeasure: 'llm', quantity: 'llm', unit: 'llm', foods: 'llm' },
};

describe('a 600-character paste line through the real CRF adapter and pipeline', () => {
    it('is not sent to the engine, raises no tier failure, and lands from the LLM leg alone', async () => {
        const send = vi.fn();
        const crf = createCrfInvokeEngine({
            functionName: 'kitchensink-ingredient-parser-sandbox',
            client: { send } as never,
            declaredEngineVersion: 'ingredient-parser-nlp==2.3.0',
            stage: 'sandbox',
            emit: vi.fn(),
        });
        const llm: ParseEnginePort<'llm'> = {
            engine: 'llm',
            engineVersion: 'test-model@1',
            parse: vi.fn().mockResolvedValue([LLM_READING]),
        };
        const onTierFailure = vi.fn();

        const [outcome] = await runParsePipeline(
            [LONG_LINE],
            {
                corrections: NO_CORRECTIONS,
                cache: NO_CACHE,
                engines: { crf, llm },
                digest: (value: string) => createHash('sha256').update(value).digest('hex'),
            },
            { userId: 'u-1' },
            { onTierFailure, onUnreadablePayload: vi.fn() },
        );

        expect(send).not.toHaveBeenCalled();
        expect(onTierFailure).not.toHaveBeenCalled();
        expect(outcome?.tier).toBe('parse');
        expect(outcome?.tier === 'parse' ? outcome.agreement : null).toEqual({
            kind: 'single-engine',
            engine: 'llm',
        });
        expect(outcome?.parsed?.foods).toEqual([{ name: 'flour', prep: null }]);
    });
});
