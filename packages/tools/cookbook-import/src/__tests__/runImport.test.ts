/**
 * THE BATCH PARSE STAGE, WIRED INTO THE RUN (plan U22, phase 5).
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | U22 — the pipeline reads the accepted lines in ONE batch | "one batch for the whole run" |
 * | ADR-0026 — the winner rule is OBSERVE-ONLY until U23's oracle lands | "the wire is unchanged" |
 * | U22 — no regression in line count | "the same recipes, the same lines" |
 * | U22 — the confectioner's-sugar case survives | "the confectioner's-sugar clause" |
 * | ADR-0026 §6 — `cookbook-import` gets Null Objects and NO database | "no database" |
 *
 * ## ⛔ WHY THE WIRING IS OBSERVATIONAL, AND WHY THAT IS THE ASSERTION
 *
 * ADR-0026's own residual risk says the field-level winner rule is "evidence-SHAPED, not evidence-BACKED …
 * **Observe-only until it lands**", and U23's oracle has not run. Substituting the pipeline's reading for
 * `proseRecipe`'s would also DETACH R35's disclosure from the values it discloses: `restateHistoricalUnit`
 * rewrites `quantity`/`unit` inside `toCandidateRecipe`, and `buildDescription` states that conversion in the
 * recipe's persisted description. The comparator's `llmRescuedTheMeasure` is precisely the path that reads a
 * gill the CRF is blind to — so the failure would fire on the historical-measure lines the feature exists to
 * improve, publishing an un-restated `1 gill` under a description claiming it was converted.
 *
 * So the create requests are asserted BYTE-IDENTICAL with the observation on and off. That assertion is what
 * makes "no regression in line count" a property of the code rather than a hope, and it is the one to change
 * — deliberately, with the oracle in hand — when the pipeline is promoted to the authority.
 */
import { describe, it, expect } from 'vitest';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EngineAnswer, ParseEnginePort, ParsePipelineDeps } from '@kitchensink/recipe-import-core';
import { NO_CACHE, NO_CORRECTIONS, promoteCrfReading, promoteLlmParse } from '@kitchensink/recipe-import-core';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

import { COOKBOOKS, PUBLIC_DOMAIN_HEADER } from '../cookbooks.js';
import { ImportLedger } from '../importLedger.js';
import { runImport, type ImportApiPort, type ParseObservation } from '../runImport.js';
import type { CreateRecipeBody, Ingredient, IngredientSuggestions, RecipeDetail } from '../RecipeApiClient.js';
import manifest from '../../package.json' with { type: 'json' };

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The committed excerpt the golden-corpus suites already use, carrying the header the run VERIFIES.
 *
 * ⚠️ The header is prepended rather than committed into the fixture, because `assertPublicDomain` re-checks
 * it "against the actual bytes at import time" and the excerpt file is a slice, not a Gutenberg download.
 * The operator's real file carries it; a run whose fixture did not would be testing a path no operator takes.
 */
function readExcerpts(): string {
    return `${PUBLIC_DOMAIN_HEADER} most other parts of the world at no cost.\n\n${readFileSync(
        join(HERE, '..', '..', 'fixtures', 'cookbookExcerpts.txt'),
        'utf8',
    )}`;
}

/** The book these excerpts are from, with its public-domain header prepended so the run's check passes. */
const BOOK = COOKBOOKS['international-jewish'] as (typeof COOKBOOKS)[string];

/** A catalog row the fake service hands back for any name. */
function makeIngredient(name: string): Ingredient {
    return {
        id: `ing_${createHash('sha256').update(name).digest('hex').slice(0, 12)}`,
        name,
        foodResolutionStatus: 'RESOLVED',
    } as unknown as Ingredient;
}

/** A recipe API that accepts everything and records every body it was sent. */
function makeApi(): ImportApiPort & { readonly created: CreateRecipeBody[] } {
    const created: CreateRecipeBody[] = [];

    return {
        created,
        async suggestIngredients(): Promise<IngredientSuggestions> {
            return { suggestions: [], catalogAvailability: 'ok' } as unknown as IngredientSuggestions;
        },
        async addIngredientByFood(foodId): Promise<Ingredient> {
            return makeIngredient(foodId);
        },
        async addIngredientByName(name): Promise<Ingredient> {
            return makeIngredient(name);
        },
        async createFreeformIngredient(name): Promise<Ingredient> {
            return makeIngredient(name);
        },
        async createRecipe(recipe): Promise<RecipeDetail> {
            created.push(recipe);

            return { id: `rec_${created.length}` } as unknown as RecipeDetail;
        },
        async getIngredientStatus(ingredientId): Promise<Ingredient> {
            return makeIngredient(ingredientId);
        },
    };
}

/**
 * A ledger that remembers nothing between runs.
 *
 * ⚠️ A FRESH path per run, not a shared one. `ImportLedger.record` writes through to disk, so a shared file
 * would make every run after the first report `alreadyImported` and observe ZERO lines — and the comparison
 * tests would then pass by comparing two empty runs, which is why each of them also asserts non-emptiness.
 */
function makeLedger(): ImportLedger {
    return ImportLedger.load(join(tmpdir(), `runImport-${randomUUID()}.json`));
}

/** Both engines, answering every line with the same trivially-agreeing reading. */
function makeEngines(): {
    readonly deps: ParsePipelineDeps;
    readonly crfBatches: (readonly string[])[];
    readonly llmBatches: (readonly string[])[];
} {
    const crfBatches: (readonly string[])[] = [];
    const llmBatches: (readonly string[])[] = [];
    const crf: ParseEnginePort<'crf'> = {
        engine: 'crf',
        engineVersion: 'ingredient-parser-nlp==2.3.0',
        async parse(lines): Promise<readonly EngineAnswer[]> {
            crfBatches.push(lines);

            return lines.map((line) =>
                promoteCrfReading(
                    { sentence: line, measure: '', names: [line], size: null, preparation: null, comment: null },
                    line,
                ),
            );
        },
    };
    const llm: ParseEnginePort<'llm'> = {
        engine: 'llm',
        engineVersion: 'amazon.nova-micro-v1:0@v1',
        async parse(lines): Promise<readonly EngineAnswer[]> {
            llmBatches.push(lines);

            return lines.map((line) =>
                promoteLlmParse({ statedMeasure: null, foods: [{ name: line, prep: null }] }, line),
            );
        },
    };

    return {
        crfBatches,
        llmBatches,
        deps: {
            corrections: NO_CORRECTIONS,
            cache: NO_CACHE,
            engines: { crf, llm },
            digest: (value) => createHash('sha256').update(value).digest('hex'),
        },
    };
}

/** Run the importer over the committed excerpts. */
async function importExcerpts(parseObservation: ParseObservation, limit = 10) {
    const api = makeApi();
    const report = await runImport({
        book: BOOK,
        plainText: readExcerpts(),
        client: api,
        ledger: makeLedger(),
        limit,
        settleMs: 0,
        parseObservation,
        log: () => undefined,
    });

    return { api, report };
}

describe('the run without the parse observation', () => {
    it('imports recipes from the committed excerpts', async () => {
        const { api, report } = await importExcerpts({ kind: 'off' });

        // Non-vacuity: every assertion below compares two runs, and comparing two empty runs proves nothing.
        expect(report.imported).toBeGreaterThan(0);
        expect(api.created.length).toBe(report.imported);
        expect(report.ingredientLines).toBeGreaterThan(5);
    });

    it('reports no observation section at all — which is not the same as observing nothing', async () => {
        const { report } = await importExcerpts({ kind: 'off' });

        expect(report.parseObservation).toBeUndefined();
    });
});

describe('the run WITH the parse observation', () => {
    it('reads the accepted lines in ONE batch per engine', async () => {
        // ⛔ ONE batch for the whole run, never one per recipe. `crfProcess.ts` loads a CRF model at import
        // and warns that per-line spawning "would turn a two-second job into a quarter of an hour"; per
        // RECIPE is the same failure with a smaller constant.
        const engines = makeEngines();
        const { report } = await importExcerpts({ kind: 'on', deps: engines.deps, spentMicros: () => 0 });

        expect(engines.crfBatches).toHaveLength(1);
        expect(engines.llmBatches).toHaveLength(1);
        expect(engines.crfBatches[0]?.length).toBeGreaterThan(5);
        expect(report.parseObservation?.lines).toBe(engines.crfBatches[0]?.length);
    });

    it('gives the engines the SOURCE clauses, not the strings the extractor produced', async () => {
        // ⛔ `raw` is what `parseIngredientLine` RECEIVED, after `normalizeQuantity` turned "one" into "1".
        // Handing an engine a string WE produced from our own parse is the "gate that reports success by
        // construction" `recipeIngredientSourceLineSchema` refuses.
        const engines = makeEngines();

        await importExcerpts({ kind: 'on', deps: engines.deps, spentMicros: () => 0 });

        const batch = engines.crfBatches[0] as readonly string[];

        expect(batch.some((line) => /\bone\b/iu.test(line))).toBe(true);
    });

    it('leaves the wire UNCHANGED — the winner rule is observe-only until U23`s oracle lands', async () => {
        // ⛔ THE LOAD-BEARING ASSERTION of this unit. See the module header for both reasons.
        const engines = makeEngines();
        const observed = await importExcerpts({ kind: 'on', deps: engines.deps, spentMicros: () => 0 });
        const plain = await importExcerpts({ kind: 'off' });

        // Non-vacuity BEFORE the invariant: two empty runs are trivially equal, and a ledger left over from
        // another run is exactly how this suite would come to compare two of them.
        expect(observed.api.created.length).toBeGreaterThan(0);
        expect(engines.crfBatches[0]?.length).toBeGreaterThan(0);
        expect(observed.api.created).toEqual(plain.api.created);
    });

    it('the same recipes, the same lines — no regression in line count', async () => {
        const engines = makeEngines();
        const observed = await importExcerpts({ kind: 'on', deps: engines.deps, spentMicros: () => 0 });
        const plain = await importExcerpts({ kind: 'off' });

        expect(plain.report.ingredientLines).toBeGreaterThan(5);
        expect(observed.report.imported).toBe(plain.report.imported);
        expect(observed.report.ingredientLines).toBe(plain.report.ingredientLines);
        expect(observed.report.candidates).toBe(plain.report.candidates);
        expect(observed.report.skipped).toEqual(plain.report.skipped);
    });

    it('the confectioner`s-sugar clause survives, at its full stated amount', async () => {
        // The clause "One and one-half cups of confectioner's sugar" was once cut into "One" and "one-half
        // cups …" and imported as 0.5 cups with `needsReview: false`. It is in the committed excerpts, and
        // this run must still carry it whole.
        const engines = makeEngines();
        const { api } = await importExcerpts({ kind: 'on', deps: engines.deps, spentMicros: () => 0 });
        const lines = api.created.flatMap((recipe) => recipe.ingredients);
        const sugar = lines.find((line) => line.sourceLine?.toLowerCase().includes("confectioner's sugar"));

        expect(sugar).toBeDefined();
        expect(sugar?.quantity).toEqual({ kind: 'exact', value: 1.5 });
    });

    it('records what the two engines amounted to, and what a person answered separately', async () => {
        const engines = makeEngines();
        const { report } = await importExcerpts({ kind: 'on', deps: engines.deps, spentMicros: () => 12_345 });
        const observation = report.parseObservation;

        expect(observation).toBeDefined();
        // ⛔ A correction is not an adjudication, so the two counters never share a denominator.
        expect(observation?.corrected).toBe(0);
        expect(Object.values(observation?.agreement ?? {}).reduce((sum, count) => sum + count, 0)).toBe(
            observation?.lines,
        );
        expect(observation?.spentMicros).toBe(12_345);
        expect(observation?.tierFailures).toEqual({});
        expect(observation?.unreadablePayloads).toEqual({});
    });

    it('bounds the observed batch by the run`s own limit, so it never pays for lines it will not import', async () => {
        const wide = makeEngines();
        const narrow = makeEngines();

        await importExcerpts({ kind: 'on', deps: wide.deps, spentMicros: () => 0 }, 10);
        await importExcerpts({ kind: 'on', deps: narrow.deps, spentMicros: () => 0 }, 1);

        expect((narrow.crfBatches[0] ?? []).length).toBeLessThan((wide.crfBatches[0] ?? []).length);
    });

    it('an engine that fails does not fail the import', async () => {
        const engines = makeEngines();
        const failing: ParsePipelineDeps = {
            ...engines.deps,
            engines: {
                ...engines.deps.engines,
                crf: {
                    engine: 'crf',
                    engineVersion: 'ingredient-parser-nlp==2.3.0',
                    async parse(): Promise<readonly EngineAnswer[]> {
                        throw new Error('crfParse.py exited 1');
                    },
                },
            },
        };
        const { api, report } = await importExcerpts({ kind: 'on', deps: failing, spentMicros: () => 0 });

        expect(api.created.length).toBeGreaterThan(0);
        expect(report.parseObservation?.tierFailures).toEqual({ crf: 1 });
        expect(report.parseObservation?.agreement['single-engine']).toBe(report.parseObservation?.lines);
    });
});

describe('no database — ADR-0026 §6, asserted rather than only written down', () => {
    it('the manifest carries neither `pg` nor `drizzle-orm`', () => {
        // ⛔ The ADR says this package "must not acquire a database": reaching the recipe service's DALs over
        // HTTP would mean a new wire surface plus everything ADR-0014 and GR-017 attach to one, for a single
        // non-product caller. Nothing enforced it until this assertion — the same shape as `recipe-core`'s
        // leaf-property test.
        const declared = { ...manifest.dependencies, ...manifest.devDependencies };

        expect(Object.keys(declared)).not.toContain('pg');
        expect(Object.keys(declared)).not.toContain('drizzle-orm');
        expect(Object.keys(declared)).not.toContain('@kitchensink/recipe-service');
    });
});
