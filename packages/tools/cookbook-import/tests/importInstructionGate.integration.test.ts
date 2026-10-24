/**
 * Integration tier — THE INSTRUCTION GATE IN FRONT OF THE REAL PYTHON CRF (plan 001; owner ruling 2026-10-01:
 * cookbook import only).
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | An instruction clause reaches no engine; the clauses around it still do | "the real engine never sees it" |
 * | The skipped clause is still imported, with the extractor's reading | "still imported" |
 * | No accepted line of the committed 1919 excerpts is skipped | "skips nothing in the excerpts" |
 *
 * What this tier proves that the unit tier cannot: the gate holds in front of the REAL `ingredient-parser-nlp`
 * process, and that process still reads every other clause of a batch with a hole in it. A recording stub proves
 * only that the stub was not called.
 *
 * ⚠️ Skipped (not failed) when `python3 -c "import ingredient_parser"` does not succeed, mirroring
 * `parsePipeline.integration.test.ts`. CI installs the pinned engine, so CI runs it. No model is called: the LLM leg
 * answers `unavailable`, which the pipeline treats as absence.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    NO_CACHE,
    NO_CORRECTIONS,
    type EngineAnswer,
    type ParseEnginePort,
    type ParsePipelineDeps,
} from '@kitchensink/recipe-import-core';
import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import { afterAll, describe, expect, it } from 'vitest';

import { COOKBOOKS, PUBLIC_DOMAIN_HEADER } from '../src/cookbooks.js';
import { ImportLedger } from '../src/importLedger.js';
import { createCrfEngine } from '../src/parsing/crfEngine.js';
import { runImport, type ImportApiPort, type ParseObservation } from '../src/runImport.js';
import type { FoodSearchPort } from '../src/resolveIngredient.js';
import type { CreateRecipeBody, Ingredient, RecipeDetail } from '../src/RecipeApiClient.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The book the excerpts come from. */
const BOOK = COOKBOOKS['international-jewish'] as (typeof COOKBOOKS)[string];

/**
 * A clause the real extractor accepts and the gate reads as an instruction. Not book text: no accepted clause of the
 * 1919 book reads as one (0 of 1,842, measured 2026-10-01). `parse-ingredient` reads the verb `drop` as a unit, so
 * the extractor accepts an ingredient named `in`.
 */
const INSTRUCTION_CLAUSE = 'drop in 2 pans';

/** A one-recipe book with {@link INSTRUCTION_CLAUSE} between ingredient clauses. */
const INSTRUCTION_BOOK = [
    `${PUBLIC_DOMAIN_HEADER} most other parts of the world at no cost.`,
    '*** START OF THE PROJECT GUTENBERG EBOOK EXCERPTS FOR TESTING ***',
    'DROP CAKES',
    `Cream one-half cup of butter with one cup of sugar until smooth and light; ${INSTRUCTION_CLAUSE}, and cover ` +
        'with two cups of flour mixed with one teaspoon of baking powder and one-half cup of milk. Bake in a ' +
        'moderate oven ten minutes, until a light brown.',
    '*** END OF THE PROJECT GUTENBERG EBOOK EXCERPTS FOR TESTING ***',
].join('\n\n');

/** The committed 1919 excerpts, with the header the run verifies. */
function readExcerpts(): string {
    return `${PUBLIC_DOMAIN_HEADER} most other parts of the world at no cost.\n\n${readFileSync(
        join(HERE, '..', 'fixtures', 'cookbookExcerpts.txt'),
        'utf8',
    )}`;
}

function crfIsInstalled(): boolean {
    try {
        execFileSync('python3', ['-c', 'import ingredient_parser'], { stdio: 'ignore' });

        return true;
    } catch {
        return false;
    }
}

const describeIfInstalled = crfIsInstalled() ? describe : describe.skip;

/** A recipe API that accepts everything and records every body it was sent. */
function makeApi(): ImportApiPort & { readonly created: CreateRecipeBody[] } {
    const created: CreateRecipeBody[] = [];
    const ingredient = (name: string): Ingredient => ({
        id: `ing_${createHash('sha256').update(name).digest('hex').slice(0, 12)}`,
        name,
        foodResolutionStatus: 'RESOLVED',
        isUserEntered: false,
        createdAt: '2026-01-01T00:00:00.000Z',
    });

    return {
        created,
        async addIngredientByFood(foodId): Promise<Ingredient> {
            return ingredient(foodId);
        },
        async addIngredientByFoodVariant(foodVariantId): Promise<Ingredient> {
            return ingredient(foodVariantId);
        },
        async addIngredientByName(name): Promise<Ingredient> {
            return ingredient(name);
        },
        async createFreeformIngredient(name): Promise<Ingredient> {
            return ingredient(name);
        },
        async createRecipe(recipe): Promise<RecipeDetail> {
            created.push(recipe);

            return makeRecipeDetail({ id: `rec_${created.length}` });
        },
        async getIngredientStatus(ingredientId): Promise<Ingredient> {
            return ingredient(ingredientId);
        },
    };
}

/** Food's two searches, finding nothing: every line then goes the "Not listed?" way. */
const NO_FOODS: FoodSearchPort = {
    searchAuthored: async () => ({ results: [] }),
    searchCatalog: async () => ({ results: [] }),
};

/** Ledger files this suite wrote, removed in `afterAll` so a failing test still cleans up. */
const ledgerFiles: string[] = [];

afterAll(() => {
    for (const file of ledgerFiles) {
        rmSync(file, { force: true });
    }
});

/** The real CRF, recording every line it is handed, beside an LLM leg that is absent for every line. */
async function makeEngines(): Promise<{ readonly deps: ParsePipelineDeps; readonly crfLines: string[] }> {
    const real = await createCrfEngine();
    const crfLines: string[] = [];
    const crf: ParseEnginePort<'crf'> = {
        engine: 'crf',
        engineVersion: real.engineVersion,
        async parse(lines): Promise<readonly EngineAnswer[]> {
            crfLines.push(...lines);

            return real.parse(lines);
        },
    };
    const llm: ParseEnginePort<'llm'> = {
        engine: 'llm',
        engineVersion: 'absent',
        async parse(lines): Promise<readonly EngineAnswer[]> {
            if (lines.includes(INSTRUCTION_CLAUSE)) {
                throw new Error('the instruction gate should have kept this clause from the model leg');
            }

            return lines.map(() => ({ unavailable: true }));
        },
    };

    return {
        crfLines,
        deps: {
            corrections: NO_CORRECTIONS,
            cache: NO_CACHE,
            engines: { crf, llm },
            digest: (value) => createHash('sha256').update(value).digest('hex'),
        },
    };
}

/** Run the importer over `plainText`. */
async function importText(plainText: string, parseObservation: ParseObservation) {
    const api = makeApi();
    const ledger = join(tmpdir(), `importInstructionGate-${randomUUID()}.json`);

    ledgerFiles.push(ledger);

    const report = await runImport({
        book: BOOK,
        plainText,
        client: api,
        foodSearch: NO_FOODS,
        ledger: ImportLedger.load(ledger),
        limit: 10,
        settleMs: 0,
        parseObservation,
        log: () => undefined,
    });

    return { api, report };
}

/** The created line that came from `sourceLine`. */
function lineFrom(created: readonly CreateRecipeBody[], sourceLine: string) {
    return created.flatMap((recipe) => recipe.ingredients).find((line) => line.sourceLine === sourceLine);
}

describeIfInstalled('the instruction gate over the real CRF engine', () => {
    it('the real engine never sees the instruction clause, and reads every clause around it', async () => {
        const engines = await makeEngines();
        const { report } = await importText(INSTRUCTION_BOOK, {
            kind: 'on',
            deps: engines.deps,
            spentMicros: () => 0,
        });

        expect(engines.crfLines).not.toContain(INSTRUCTION_CLAUSE);
        expect(engines.crfLines).toContain('one-half cup of milk');
        expect(report.parseObservation?.skippedAsInstruction).toEqual([INSTRUCTION_CLAUSE]);
        expect(report.parseObservation?.lines).toBe(engines.crfLines.length);
        // The model leg is absent, so every line read is the real CRF's alone.
        expect(report.parseObservation?.agreement['single-engine']).toBe(engines.crfLines.length);
        expect(report.parseObservation?.tierFailures).toEqual({});
    }, 180_000);

    it('the skipped clause is still imported, with the reading it has when no engine runs', async () => {
        const engines = await makeEngines();
        const gated = await importText(INSTRUCTION_BOOK, { kind: 'on', deps: engines.deps, spentMicros: () => 0 });
        const plain = await importText(INSTRUCTION_BOOK, { kind: 'off' });

        expect(lineFrom(plain.api.created, INSTRUCTION_CLAUSE)).toBeDefined();
        expect(lineFrom(gated.api.created, INSTRUCTION_CLAUSE)).toEqual(
            lineFrom(plain.api.created, INSTRUCTION_CLAUSE),
        );
        expect(gated.report.ingredientLines).toBe(plain.report.ingredientLines);
        // The real CRF's reading of a clause beside the hole reaches the wire.
        expect(lineFrom(gated.api.created, 'one-half cup of milk')?.quantity).toEqual({ kind: 'exact', value: 0.5 });
    }, 180_000);

    it('skips nothing in the committed 1919 excerpts, so every accepted line still reaches the engine', async () => {
        const engines = await makeEngines();
        const { report } = await importText(readExcerpts(), { kind: 'on', deps: engines.deps, spentMicros: () => 0 });

        expect(report.parseObservation?.lines).toBeGreaterThan(5);
        expect(report.parseObservation?.skippedAsInstruction).toEqual([]);
        expect(report.parseObservation?.lines).toBe(engines.crfLines.length);
    }, 180_000);
});
