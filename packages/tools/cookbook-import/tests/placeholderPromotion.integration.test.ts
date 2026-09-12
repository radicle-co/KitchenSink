/**
 * Integration tier — THE PLACEHOLDER MUST NOT BE PROMOTED INTO A PUBLISHED INGREDIENT NAME.
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | R5 — a line no reader found a food on gets its own text as a PLACEHOLDER | "the pipeline really does stamp the placeholder" |
 * | ADR-0026 — the promotion substitutes a READING, and a placeholder is not one | "declines the placeholder and keeps the library's name" |
 * | ADR-0026 — a real one-food reading is still promoted | "still promotes a reading an engine actually produced" |
 *
 * ## ⛔ WHY THIS TIER, AND WHY A UNIT TEST CANNOT STAND IN FOR IT
 *
 * The defect this closes is a COMPOSITION of two modules that are each correct alone:
 * `applyPipelineReading` substitutes a reading only when it names EXACTLY ONE food, declining on zero —
 * and R5 then made zero foods UNREPRESENTABLE for a non-blank line, so the decline branch became
 * unreachable and the placeholder (the whole source clause) replaced the library parser's name in a
 * published `imported_public` recipe. `"one pound of fine flour"` becomes an ingredient NAME; the only
 * nets downstream are a length slice and a `NOT_AN_INGREDIENT` set, and neither stops it.
 *
 * A unit test that hand-builds a `ParsedLine` carrying `name_is_source_line` asserts our BELIEF about what
 * R5 produces. It would keep passing if R5 changed its reason, its shape, or the order it fires in — which
 * is precisely how the two halves drifted into each other in the first place. So this tier drives the REAL
 * `runParsePipeline` and the REAL `compareParses`, keys the readings exactly as `observeParses` does, and
 * re-runs `toCandidateRecipe` with them exactly as `runImport`'s third pass does.
 *
 * ⚠️ It needs no Python and no service: the ENGINES are the fakes (a foodless answer is what 3.95% of
 * measured lines really look like), and everything between them and the stored candidate is the shipped
 * code. What is faked is the input to the composition, never the composition.
 */
import { createHash } from 'node:crypto';

import {
    NO_CACHE,
    NO_CORRECTIONS,
    promoteCrfReading,
    promoteLlmParse,
    runParsePipeline,
    type EngineAnswer,
    type ParsedLine,
    type ParseEnginePorts,
    type ParsePipelineObservers,
} from '@kitchensink/recipe-import-core';
import type { HexDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import { describe, expect, it } from 'vitest';

import { toCandidateRecipe, type CandidateIngredient } from '../src/proseRecipe.js';
import type { CookbookBlock } from '../src/gutenbergBook.adapter.js';

/** The real hash the worker uses, so the cache keys here are the keys the table would hold. */
const sha256: HexDigest = (value) => createHash('sha256').update(value).digest('hex');

/** 1919 prose whose butter clause the library parser reads cleanly — the name the promotion must not lose. */
const BLOCK: CookbookBlock = {
    title: 'PLACEHOLDER PROBE',
    paragraphs: [
        'Cut the bread in slices one-quarter inch thick and two inches square, then take one pound of' +
            ' butter, one teaspoon of chopped onion and one cup of milk; let cook slowly two hours.' +
            ' Serve at once on a hot dish with the sauce poured over the top.',
    ],
};

const OBSERVERS: ParsePipelineObservers = {
    onTierFailure: (tier, error) => {
        throw new Error(`tier ${tier} failed: ${String(error)}`);
    },
    onUnreadablePayload: (payload) => {
        throw new Error(`unreadable payload from ${payload.tier}`);
    },
};

/**
 * Engines that answer every line the measured foodless way — a measure, and no food at all.
 *
 * Both answers go through the REAL promoters, so the `''`-vs-`null` collapse, the placement rules and the
 * measure reading are the shipped ones rather than a fixture's idea of them.
 */
function makeFoodlessEngines(): ParseEnginePorts {
    return {
        crf: {
            engine: 'crf',
            engineVersion: 'ingredient-parser-nlp==2.3.0',
            async parse(lines): Promise<readonly EngineAnswer[]> {
                return lines.map((line) =>
                    promoteCrfReading(
                        { sentence: line, measure: '', names: [], size: null, preparation: null, comment: null },
                        line,
                    ),
                );
            },
        },
        llm: {
            engine: 'llm',
            engineVersion: 'amazon.nova-micro-v1:0@v1',
            async parse(lines): Promise<readonly EngineAnswer[]> {
                return lines.map((line) => promoteLlmParse({ statedMeasure: null, foods: [] }, line));
            },
        },
    };
}

/**
 * An engine pair that names one real food per line, so the promotion's ACCEPTING path is exercised too.
 *
 * ⚠️ The name is derived from the line's own last word rather than fixed, because `toCandidateRecipe`
 * de-duplicates ingredients by name: three lines promoted to one name collapse to one ingredient and the
 * block is refused `too_few_ingredients`, which would report as a failure of the promotion.
 */
function makeNamingEngines(): ParseEnginePorts {
    const nameFor = (line: string): string => `sweet ${line.split(' ').at(-1) ?? line}`;

    return {
        crf: {
            engine: 'crf',
            engineVersion: 'ingredient-parser-nlp==2.3.0',
            async parse(lines): Promise<readonly EngineAnswer[]> {
                return lines.map((line) =>
                    promoteCrfReading(
                        {
                            sentence: line,
                            measure: '1 pound',
                            names: [nameFor(line)],
                            size: null,
                            preparation: null,
                            comment: null,
                        },
                        line,
                    ),
                );
            },
        },
        llm: {
            engine: 'llm',
            engineVersion: 'amazon.nova-micro-v1:0@v1',
            async parse(lines): Promise<readonly EngineAnswer[]> {
                return lines.map((line) =>
                    promoteLlmParse({ statedMeasure: '1 pound', foods: [{ name: nameFor(line), prep: null }] }, line),
                );
            },
        },
    };
}

/** The candidate's ingredient lines, or a loud failure — a skipped block would make every assertion vacuous. */
function ingredientsOf(readings?: ReadonlyMap<string, ParsedLine>): readonly CandidateIngredient[] {
    const outcome = toCandidateRecipe(BLOCK, undefined, readings);

    if (outcome.kind !== 'candidate') {
        throw new Error(`the probe block no longer parses: ${outcome.reason}`);
    }

    return outcome.recipe.ingredients;
}

/** The readings map, built the way `observeParses` builds it: keyed by the line the pipeline was given. */
async function readingsFor(engines: ParseEnginePorts): Promise<ReadonlyMap<string, ParsedLine>> {
    const lines = ingredientsOf().map((ingredient) => ingredient.sourceText);
    const outcomes = await runParsePipeline(
        lines,
        { corrections: NO_CORRECTIONS, cache: NO_CACHE, engines, digest: sha256 },
        { userId: undefined },
        OBSERVERS,
    );
    const readings = new Map<string, ParsedLine>();

    for (const [index, outcome] of outcomes.entries()) {
        const line = lines[index];

        if (line !== undefined && outcome.parsed !== null) {
            readings.set(line, outcome.parsed);
        }
    }

    return readings;
}

describe('the R5 placeholder, carried through the real pipeline into the importer', () => {
    it('the pipeline really does stamp the placeholder — the precondition, asserted rather than assumed', async () => {
        const readings = await readingsFor(makeFoodlessEngines());
        const butter = readings.get('one pound of butter');

        expect(butter?.reviewReasons).toContain('name_is_source_line');
        expect(butter?.foods).toEqual([{ name: 'one pound of butter', prep: null }]);
    });

    /**
     * ⛔ THE BLOCKER. The decline branch `applyPipelineReading`'s docstring describes — "zero foods or
     * several is a SEGMENTATION disagreement… declining keeps the reading that shipped" — is unreachable
     * once R5 guarantees a food, so the whole source clause lands as the ingredient's NAME.
     */
    it('declines the placeholder and keeps the library parser’s name', async () => {
        const promoted = ingredientsOf(await readingsFor(makeFoodlessEngines()));

        expect(promoted.map((ingredient) => ingredient.name)).toContain('butter');
        expect(promoted.map((ingredient) => ingredient.name)).not.toContain('one pound of butter');
    });

    it('⛔ declines it WHOLE — a placeholder’s measure must not ride in behind the name either', async () => {
        const promoted = ingredientsOf(await readingsFor(makeFoodlessEngines()));
        const library = ingredientsOf();

        expect(promoted).toStrictEqual(library);
    });

    /**
     * ⚠️ The veto is `name_is_source_line` and NOTHING more. A food an engine actually named is a reading,
     * and promoting it is what this parameter exists for — including a food only the CRF named, which R1
     * rescues. Narrowing the veto to "zero foods before R5" would take that with it.
     */
    it('still promotes a reading an engine actually produced', async () => {
        const promoted = ingredientsOf(await readingsFor(makeNamingEngines()));

        expect(promoted.map((ingredient) => ingredient.name)).toContain('sweet butter');
    });
});
