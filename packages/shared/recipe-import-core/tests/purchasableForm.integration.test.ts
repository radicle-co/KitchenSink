/**
 * A form the cook BUYS stays in the food's name through the whole parse pipeline (dogfooding PR 132).
 *
 * `2 tablespoons unsalted butter, melted` was stored as `butter` with the preparation `melted unsalted`: both engines
 * kept `unsalted` in the name, and the merge's placement step moved it out because the lexicon read `-ed` as
 * preparation. The paste then bound salted butter. This runs the real pipeline (both promotion adapters, the merge,
 * the cache bookkeeping) with engines that answer what the real ones answered for the line, so a lexicon that moves
 * the word again fails here and not only in the comparator's unit tier.
 *
 * The CRF row is the engine's real answer, measured with `ingredient-parser-nlp` 2.3.0 on 2026-11-06.
 */
import { createHash } from 'node:crypto';

import type { HexDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import { describe, it, expect } from 'vitest';

import {
    NO_CACHE,
    NO_CORRECTIONS,
    promoteCrfReading,
    promoteLlmParse,
    runParsePipeline,
    type CrfReading,
    type EngineAnswer,
    type ParseEnginePorts,
} from '../src/index.js';

const sha256: HexDigest = (value) => createHash('sha256').update(value).digest('hex');

const LINE = '2 tablespoons unsalted butter, melted';

/** What the CRF sidecar returns for {@link LINE}. */
const CRF_ROW: CrfReading = {
    sentence: LINE,
    measure: '2 tablespoons',
    names: ['unsalted butter'],
    size: null,
    preparation: 'melted',
    comment: null,
};

/** Both engines, answering the one line as the deployed ones do. */
const engines: ParseEnginePorts = {
    crf: {
        engine: 'crf',
        engineVersion: 'ingredient-parser-nlp==2.3.0',
        async parse(lines): Promise<readonly EngineAnswer[]> {
            return lines.map((line) => promoteCrfReading(CRF_ROW, line));
        },
    },
    llm: {
        engine: 'llm',
        engineVersion: 'test-llm@v1',
        async parse(lines): Promise<readonly EngineAnswer[]> {
            return lines.map((line) =>
                promoteLlmParse(
                    {
                        statedMeasure: '2 tablespoons',
                        foods: [{ name: 'unsalted butter', prep: 'melted', display: 'food' }],
                    },
                    line,
                ),
            );
        },
    },
};

describe('a purchasable form survives the parse pipeline', () => {
    it('stores `unsalted butter` with the preparation `melted`, and the engines agree', async () => {
        const [outcome] = await runParsePipeline(
            [LINE],
            { corrections: NO_CORRECTIONS, cache: NO_CACHE, engines, digest: sha256 },
            { userId: undefined },
            { onTierFailure: () => undefined, onUnreadablePayload: () => undefined },
        );

        expect(outcome?.tier).toBe('parse');
        expect(outcome?.parsed?.foods).toEqual([{ name: 'unsalted butter', prep: 'melted', display: 'food' }]);
        expect(outcome !== undefined && 'agreement' in outcome ? outcome.agreement : undefined).toEqual({
            kind: 'agree',
        });
    });
});

/**
 * Owner ruling 2026-11-06: `dried`, `frozen` and `canned` stay in the name through the whole pipeline. Each CRF row is
 * the engine's real answer (`ingredient-parser-nlp` 2.3.0, run 2026-11-06); each LLM answer is what the parse prompt's
 * rule 7 tells the model to give ("ONLY these product descriptors stay in the name: dried, canned, … frozen").
 */
describe('dried, frozen and canned survive the parse pipeline', () => {
    const cases: readonly {
        line: string;
        crf: CrfReading;
        llm: { statedMeasure: string; name: string; prep: string | null };
    }[] = [
        {
            line: '1 tsp dried thyme',
            crf: {
                sentence: '1 tsp dried thyme',
                measure: '1 tsp',
                names: ['dried thyme'],
                size: null,
                preparation: null,
                comment: null,
            },
            llm: { statedMeasure: '1 tsp', name: 'dried thyme', prep: null },
        },
        {
            line: '2 cups frozen blueberries, thawed',
            crf: {
                sentence: '2 cups frozen blueberries, thawed',
                measure: '2 cups',
                names: ['frozen blueberries'],
                size: null,
                preparation: 'thawed',
                comment: null,
            },
            llm: { statedMeasure: '2 cups', name: 'frozen blueberries', prep: 'thawed' },
        },
        {
            line: '2 cups canned tomatoes',
            crf: {
                sentence: '2 cups canned tomatoes',
                measure: '2 cups',
                names: ['canned tomatoes'],
                size: null,
                preparation: null,
                comment: null,
            },
            llm: { statedMeasure: '2 cups', name: 'canned tomatoes', prep: null },
        },
    ];

    it.each(cases)('$line keeps the word in the food’s name', async ({ line, crf, llm }) => {
        const ports: ParseEnginePorts = {
            crf: {
                engine: 'crf',
                engineVersion: 'ingredient-parser-nlp==2.3.0',
                async parse(lines): Promise<readonly EngineAnswer[]> {
                    return lines.map((sourceLine) => promoteCrfReading(crf, sourceLine));
                },
            },
            llm: {
                engine: 'llm',
                engineVersion: 'test-llm@v1',
                async parse(lines): Promise<readonly EngineAnswer[]> {
                    return lines.map((sourceLine) =>
                        promoteLlmParse(
                            {
                                statedMeasure: llm.statedMeasure,
                                foods: [{ name: llm.name, prep: llm.prep, display: 'food' }],
                            },
                            sourceLine,
                        ),
                    );
                },
            },
        };
        const [outcome] = await runParsePipeline(
            [line],
            { corrections: NO_CORRECTIONS, cache: NO_CACHE, engines: ports, digest: sha256 },
            { userId: undefined },
            { onTierFailure: () => undefined, onUnreadablePayload: () => undefined },
        );

        expect(outcome?.parsed?.foods).toEqual([{ name: llm.name, prep: llm.prep, display: 'food' }]);
    });
});

/**
 * Owner ruling 2026-11-06: `whipped` BEFORE the food is part of its name, AFTER the comma it is the cook's step. Each
 * CRF row is the engine's real answer (`ingredient-parser-nlp` 2.3.0, run 2026-11-06). The LLM answers are what the
 * parse prompt's rule 7 tells the model to give: `whipped` is one of the descriptors that stay in the name, and a
 * word the line puts after the comma is the preparation.
 */
describe('whipped survives the parse pipeline where the cook wrote it', () => {
    const cases: readonly {
        line: string;
        crf: CrfReading;
        llm: { statedMeasure: string; name: string; prep: string | null };
    }[] = [
        {
            line: '1 cup whipped cream',
            crf: {
                sentence: '1 cup whipped cream',
                measure: '1 cup',
                names: ['whipped cream'],
                size: null,
                preparation: null,
                comment: null,
            },
            llm: { statedMeasure: '1 cup', name: 'whipped cream', prep: null },
        },
        {
            line: '1 cup heavy cream, whipped',
            crf: {
                sentence: '1 cup heavy cream, whipped',
                measure: '1 cup',
                names: ['heavy cream'],
                size: null,
                preparation: 'whipped',
                comment: null,
            },
            llm: { statedMeasure: '1 cup', name: 'heavy cream', prep: 'whipped' },
        },
    ];

    it.each(cases)('$line is stored as the cook wrote it, and the engines agree', async ({ line, crf, llm }) => {
        const ports: ParseEnginePorts = {
            crf: {
                engine: 'crf',
                engineVersion: 'ingredient-parser-nlp==2.3.0',
                async parse(lines): Promise<readonly EngineAnswer[]> {
                    return lines.map((sourceLine) => promoteCrfReading(crf, sourceLine));
                },
            },
            llm: {
                engine: 'llm',
                engineVersion: 'test-llm@v1',
                async parse(lines): Promise<readonly EngineAnswer[]> {
                    return lines.map((sourceLine) =>
                        promoteLlmParse(
                            {
                                statedMeasure: llm.statedMeasure,
                                foods: [{ name: llm.name, prep: llm.prep, display: 'food' }],
                            },
                            sourceLine,
                        ),
                    );
                },
            },
        };
        const [outcome] = await runParsePipeline(
            [line],
            { corrections: NO_CORRECTIONS, cache: NO_CACHE, engines: ports, digest: sha256 },
            { userId: undefined },
            { onTierFailure: () => undefined, onUnreadablePayload: () => undefined },
        );

        expect(outcome?.parsed?.foods).toEqual([{ name: llm.name, prep: llm.prep, display: 'food' }]);
        expect(outcome !== undefined && 'agreement' in outcome ? outcome.agreement : undefined).toEqual({
            kind: 'agree',
        });
    });
});
