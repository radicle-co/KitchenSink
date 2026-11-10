/**
 * Integration tier — what a pasted line keeps, from both engines through the merge to the row the editor saves.
 *
 * Production's paste import (2026-11-08, eleven Allrecipes recipes) lost words the source lines held. Two of the losses
 * are this pipeline's:
 *
 *  - `1/4 teaspoon celery seed` was stored as `celery` with the preparation `seed`. The merge's placement step read
 *    `seed` as a past participle because it ends in `-ed`.
 *  - `salt and pepper to taste` saved salt "to taste" and pepper with nothing. The row rule gave the line's measure to
 *    the first food only, which is right for an amount and wrong for a line that states none.
 *
 * This runs the real pipeline (both promotion adapters, the merge, its placement step) and then recipe-core's
 * `pastedLineRowOf`, the rule the editor saves a pasted row with and the paste matcher keys its verdict with. A unit
 * test of either half cannot see the seam between them. Each CRF row is the engine's real answer, measured with
 * `ingredient-parser-nlp` 2.3.0 on 2026-11-08. Each LLM answer is what the parse prompt tells the model to give: rule 5
 * makes "to taste" the unit of a line with no number, and rule 8 gives two foods with different preparations a record
 * each.
 */
import { createHash } from 'node:crypto';

import type { HexDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import { pastedLineRowOf } from '@kitchensink/recipe-core/parsing/pasted-line-measure';
import { describe, expect, it } from 'vitest';

import {
    NO_CACHE,
    NO_CORRECTIONS,
    promoteCrfReading,
    promoteLlmParse,
    runParsePipeline,
    type CrfReading,
    type EngineAnswer,
    type ParseEnginePorts,
    type ParsedLine,
} from '../src/index.js';

const sha256: HexDigest = (value) => createHash('sha256').update(value).digest('hex');

/** What the model answers for one line, in the split form the deployed leg hands over. */
interface ModelAnswer {
    readonly statedQuantity: string | null;
    readonly statedUnit: string | null;
    readonly foods: readonly { readonly name: string; readonly prep: string | null }[];
}

/**
 * Both engines answering one line as the deployed ones do.
 *
 * @param crf - The CRF sidecar's row for the line.
 * @param model - The model's split answer.
 * @returns The engine ports. @sideEffect None beyond the promotions.
 */
function enginesFor(crf: CrfReading, model: ModelAnswer): ParseEnginePorts {
    const statedMeasure = [model.statedQuantity, model.statedUnit].filter((part) => part !== null).join(' ');

    return {
        crf: {
            engine: 'crf',
            engineVersion: 'ingredient-parser-nlp==2.3.0',
            async parse(lines): Promise<readonly EngineAnswer[]> {
                return lines.map((line) => promoteCrfReading(crf, line));
            },
        },
        llm: {
            engine: 'llm',
            engineVersion: 'test-llm@v1',
            async parse(lines): Promise<readonly EngineAnswer[]> {
                return lines.map((line) =>
                    promoteLlmParse(
                        {
                            statedMeasure: statedMeasure === '' ? null : statedMeasure,
                            statedQuantity: model.statedQuantity,
                            statedUnit: model.statedUnit,
                            foods: model.foods.map((food) => ({ ...food, display: 'food' as const })),
                        },
                        line,
                    ),
                );
            },
        },
    };
}

/**
 * Run the real pipeline over one line.
 *
 * @param line - The pasted line.
 * @param ports - The engines.
 * @returns The merged parse. @sideEffect Calls the engine ports.
 */
async function parsedOf(line: string, ports: ParseEnginePorts): Promise<ParsedLine> {
    const [outcome] = await runParsePipeline(
        [line],
        { corrections: NO_CORRECTIONS, cache: NO_CACHE, engines: ports, digest: sha256 },
        { userId: undefined },
        { onTierFailure: () => undefined, onUnreadablePayload: () => undefined },
    );

    if (outcome?.parsed === undefined || outcome.parsed === null) {
        throw new Error(`the pipeline parsed nothing for ${line}`);
    }

    return outcome.parsed;
}

/** The rows the editor saves for a parse: each food's name, unit and preparation. Pure. */
function savedRowsOf(parsed: ParsedLine): readonly (readonly [string, string, string | null])[] {
    return parsed.foods.map((food, index) => {
        const row = pastedLineRowOf({ ...parsed, sourceLine: parsed.raw, display: null }, index, food.name);

        return [row.name, row.unit, food.prep] as const;
    });
}

describe('a seed is the food, through the whole paste', () => {
    it.each([
        ['1/4 teaspoon celery seed', '1/4 teaspoons', 'celery seed'],
        ['2 tablespoons flaxseed meal', '2 tablespoons', 'flaxseed meal'],
        ['1 teaspoon dried dill weed', '1 teaspoon', 'dried dill weed'],
    ])('%s keeps the whole name and no preparation', async (line, measure, name) => {
        const crf: CrfReading = {
            sentence: line,
            measure,
            names: [name],
            size: null,
            preparation: null,
            comment: null,
        };
        const [statedQuantity = null, statedUnit = null] = line.split(' ');
        const ports = enginesFor(crf, { statedQuantity, statedUnit, foods: [{ name, prep: null }] });

        expect(savedRowsOf(await parsedOf(line, ports)).map(([saved, , prep]) => [saved, prep])).toEqual([
            [name, null],
        ]);
    });
});

describe('a line with no amount says it of every food it names', () => {
    it('salt and pepper to taste: both rows are "to taste"', async () => {
        const line = 'salt and pepper to taste';
        const crf: CrfReading = {
            sentence: line,
            measure: '',
            names: ['salt', 'pepper'],
            size: null,
            preparation: null,
            comment: 'to taste',
        };
        const ports = enginesFor(crf, {
            statedQuantity: null,
            statedUnit: 'to taste',
            foods: [
                { name: 'salt', prep: null },
                { name: 'pepper', prep: null },
            ],
        });

        expect(savedRowsOf(await parsedOf(line, ports))).toEqual([
            ['salt', 'to taste', null],
            ['pepper', 'to taste', null],
        ]);
    });

    it('salt and freshly ground black pepper to taste: the pepper keeps its preparation and the phrase', async () => {
        const line = 'salt and freshly ground black pepper to taste';
        const crf: CrfReading = {
            sentence: line,
            measure: '',
            names: ['salt', 'black pepper'],
            size: null,
            preparation: 'freshly ground',
            comment: 'to taste',
        };
        const ports = enginesFor(crf, {
            statedQuantity: null,
            statedUnit: 'to taste',
            foods: [
                { name: 'salt', prep: null },
                { name: 'black pepper', prep: 'freshly ground' },
            ],
        });

        expect(savedRowsOf(await parsedOf(line, ports))).toEqual([
            ['salt', 'to taste', null],
            ['black pepper', 'to taste', 'freshly ground'],
        ]);
    });

    it('an AMOUNT still goes to the first food only: "2 tablespoons butter and flour" is not 4 tablespoons', async () => {
        const line = '2 tablespoons butter and flour';
        const crf: CrfReading = {
            sentence: line,
            measure: '2 tablespoons',
            names: ['butter', 'flour'],
            size: null,
            preparation: null,
            comment: null,
        };
        const ports = enginesFor(crf, {
            statedQuantity: '2',
            statedUnit: 'tablespoons',
            foods: [
                { name: 'butter', prep: null },
                { name: 'flour', prep: null },
            ],
        });
        const parsed = await parsedOf(line, ports);

        expect(savedRowsOf(parsed)).toEqual([
            ['butter', 'tablespoons', null],
            ['flour', '', null],
        ]);
        expect(pastedLineRowOf({ ...parsed, sourceLine: parsed.raw, display: null }, 1, 'flour').quantity).toEqual({
            kind: 'absent',
        });
    });
});
