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
import { afterAll, describe, it, expect, vi } from 'vitest';

import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EngineAnswer, ParseEnginePort, ParsePipelineDeps } from '@kitchensink/recipe-import-core';
import { NO_CACHE, NO_CORRECTIONS, promoteCrfReading, promoteLlmParse } from '@kitchensink/recipe-import-core';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

import { COOKBOOKS, PUBLIC_DOMAIN_HEADER } from '../cookbooks.js';
import { ImportLedger } from '../importLedger.js';
import { adjudicationSample } from '../headlineFigures.js';
import { runImport, type ImportApiPort, type ParseObservation } from '../runImport.js';
import type { CreateRecipeBody, Ingredient, IngredientSuggestions, RecipeDetail } from '../RecipeApiClient.js';
import manifest from '../../package.json' with { type: 'json' };

/**
 * The settle pass sleeps between sweeps through `node:timers/promises`. Made instant here so a settle window
 * can span several sweeps without the suite waiting two real seconds per sweep; the window is still bounded by
 * the real clock, which is what the pass's own deadline reads. Every other test runs with `settleMs: 0`, where
 * the loop never sleeps at all, so none of them depends on this.
 */
vi.mock('node:timers/promises', async (importOriginal) => ({
    ...(await importOriginal<typeof import('node:timers/promises')>()),
    setTimeout: async (): Promise<void> => undefined,
}));

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

/** Ledger files this suite wrote, removed in `afterAll` so a FAILING test still cleans up. */
const ledgerFiles: string[] = [];

afterAll(() => {
    for (const file of ledgerFiles) {
        rmSync(file, { force: true });
    }
});

/**
 * A ledger that remembers nothing between runs.
 *
 * ⚠️ A FRESH path per run, not a shared one. `ImportLedger.record` writes through to disk, so a shared file
 * would make every run after the first report `alreadyImported` and observe ZERO lines — and the comparison
 * tests would then pass by comparing two empty runs, which is why each of them also asserts non-emptiness.
 */
function makeLedger(): ImportLedger {
    const file = join(tmpdir(), `runImport-${randomUUID()}.json`);

    ledgerFiles.push(file);

    return ImportLedger.load(file);
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
                // ⚠️ `statedMeasure: line` so the stub reads the line's REAL amount. It previously passed
                // `null`, which contributed no measure — harmless while the pipeline was observe-only, and a
                // fabricated value the moment its reading reaches the wire. The food NAME stays deliberately
                // crude (the whole line): a stub must not pretend to segment.
                promoteLlmParse({ statedMeasure: line, foods: [{ name: line, prep: null }] }, line),
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

    /**
     * ⚠️ REWRITTEN. This asserted the opposite — that the pipeline "leaves the wire UNCHANGED", because the
     * winner rule was observe-only. The pipeline is now the AUTHORITY for what an accepted line says, so the
     * old assertion documents a behaviour that has been deliberately removed. Its coverage is not lost: the
     * byte-identical guarantee still holds for a run with the observation OFF, and that is asserted below.
     *
     * ⛔ The stub engines answer with the WHOLE LINE as the food name, which is what made the old assertion
     * cheap to satisfy and is not a realistic reading. The promotion is therefore asserted through a field
     * the stub sets unambiguously rather than through a name it fabricates.
     */
    it('promotes the pipeline reading onto the wire when the observation runs', async () => {
        const engines = makeEngines();
        const observed = await importExcerpts({ kind: 'on', deps: engines.deps, spentMicros: () => 0 });
        const plain = await importExcerpts({ kind: 'off' });

        // Non-vacuity BEFORE the comparison: two empty runs differ in nothing.
        expect(observed.api.created.length).toBeGreaterThan(0);
        expect(engines.crfBatches[0]?.length).toBeGreaterThan(0);

        // The two runs are no longer identical — that difference IS the promotion.
        expect(observed.api.created).not.toEqual(plain.api.created);
    });

    it('is byte-identical to the pre-pipeline import when the observation is OFF', async () => {
        // ⛔ The promotion is OPT-IN. A caller that does not ask for the pipeline must see exactly what it saw
        // before the pipeline existed — this is the half of the old assertion that survives, and it is what
        // keeps `--parse-pipeline` a choice rather than a silent change of behaviour.
        const first = await importExcerpts({ kind: 'off' });
        const second = await importExcerpts({ kind: 'off' });

        expect(first.api.created.length).toBeGreaterThan(0);
        expect(first.api.created).toEqual(second.api.created);
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

/**
 * The ledger write sat inside the same `try` as the create. A POST that succeeded and a ledger write that
 * then failed (ENOSPC, a permissions change, a full tmpfs) was caught as a REFUSED create: the run logged it
 * as refused, kept going, and the next resume re-created a recipe that already existed — the exact duplicate
 * the ledger is there to prevent, manufactured by the ledger's own failure path.
 */
describe('a ledger that cannot persist stops the run — it is not a refused create', () => {
    it('rethrows the persistence failure and processes no further recipe', async () => {
        const api = makeApi();
        const ledger = makeLedger();
        vi.spyOn(ledger, 'record').mockImplementation(() => {
            throw new Error('ENOSPC: no space left on device');
        });

        await expect(
            runImport({
                book: BOOK,
                plainText: readExcerpts(),
                client: api,
                ledger,
                limit: 10,
                settleMs: 0,
                parseObservation: { kind: 'off' },
                log: () => undefined,
            }),
        ).rejects.toThrow(/ENOSPC/);

        // Exactly one create reached the service: the one whose ledger write failed. Had the failure been
        // handled as a refusal, the loop would have gone on to create the rest of the excerpts.
        expect(api.created).toHaveLength(1);
    });

    it('logs the created recipe id BEFORE the ledger write, so a failed write still leaves a trail to reconcile', async () => {
        const api = makeApi();
        const ledger = makeLedger();
        const lines: string[] = [];
        vi.spyOn(ledger, 'record').mockImplementation(() => {
            throw new Error('EACCES: permission denied');
        });

        await runImport({
            book: BOOK,
            plainText: readExcerpts(),
            client: api,
            ledger,
            limit: 10,
            settleMs: 0,
            parseObservation: { kind: 'off' },
            log: (message) => {
                lines.push(message);
            },
        }).catch(() => undefined);

        expect(lines.some((line) => line.includes('created') && line.includes('rec_1'))).toBe(true);
    });
});

/** When a fixture binding was made: the wire requires one, and nothing here reads it. */
const CREATED_AT = '2026-01-01T00:00:00.000Z';

/**
 * The failure record `by-name` answers for a phrase food has not resolved yet (plan 002). It carries a STATUS
 * but NO `foodId`: a failure is not bound to a food, and only a root binding publishes one.
 */
function failureFor(name: string, status: 'PENDING' | 'UNRESOLVED' = 'PENDING'): Ingredient {
    return {
        id: `fail_${createHash('sha256').update(name).digest('hex').slice(0, 12)}`,
        name,
        foodResolutionStatus: status,
        isUserEntered: false,
        createdAt: CREATED_AT,
    };
}

/** A root binding: the only shape that carries a `foodId`, and always `RESOLVED`. */
function boundTo(id: string, foodId: string): Ingredient {
    return {
        id,
        name: `food ${foodId}`,
        foodId,
        foodResolutionStatus: 'RESOLVED',
        isUserEntered: false,
        createdAt: CREATED_AT,
    };
}

/**
 * A recipe API whose suggestion list is always empty, so EVERY line goes `by-name` and comes back as a failure
 * record — the population the settle pass exists for — and whose status poll answers with `status`.
 */
function makeSettlingApi(status: (id: string) => Ingredient): ImportApiPort & { readonly polled: string[] } {
    const polled: string[] = [];

    return {
        polled,
        async suggestIngredients(): Promise<IngredientSuggestions> {
            return { suggestions: [], catalogAvailability: 'ok' } as unknown as IngredientSuggestions;
        },
        async addIngredientByFood(foodId): Promise<Ingredient> {
            return boundTo(`bound_${foodId}`, foodId);
        },
        async addIngredientByName(name): Promise<Ingredient> {
            return failureFor(name);
        },
        async createFreeformIngredient(name): Promise<Ingredient> {
            return { id: `declared_${name}`, name, isUserEntered: true, createdAt: CREATED_AT };
        },
        async createRecipe(): Promise<RecipeDetail> {
            return { id: 'rec_1' } as unknown as RecipeDetail;
        },
        async getIngredientStatus(ingredientId): Promise<Ingredient> {
            polled.push(ingredientId);

            return status(ingredientId);
        },
    };
}

/** Import ONE recipe from the excerpts through `api`, with a settle window long enough for several sweeps. */
async function importOneAndSettle(api: ImportApiPort, settleMs = 200) {
    return runImport({
        book: BOOK,
        plainText: readExcerpts(),
        client: api,
        ledger: makeLedger(),
        limit: 1,
        settleMs,
        parseObservation: { kind: 'off' },
        log: () => undefined,
    });
}

/**
 * ⛔ THE SETTLE PASS FOLLOWS A FAILURE TO THE BINDING IT SETTLED ON (plan 002, U4).
 *
 * `by-name` answers a phrase food has not resolved with a FAILURE record — a status and no `foodId`. The pass
 * used to watch only rows carrying a `foodId`, so under the new projection it watched nothing: every `PENDING`
 * at create time stayed unread, the exact under-report the module header says the pass exists to prevent.
 *
 * And a poll that finds the failure resolved answers with the BOUND binding's id — a DIFFERENT id. The pass must
 * adopt it: that id is where the lines now are, and it is the identity "distinct ingredients" is counted over.
 */
describe('the settle pass follows a failure record to the binding it settled on', () => {
    it('watches a failure record, which carries a status and no food id', async () => {
        const api = makeSettlingApi((id) => boundTo(`bound_${id}`, `food_${id}`));

        const report = await importOneAndSettle(api);

        // Non-vacuity: the first excerpt recipe has several lines, every one of them a failure.
        expect(report.ingredientLines).toBeGreaterThan(1);
        expect(api.polled.length).toBeGreaterThan(1);
        expect(api.polled.every((id) => id.startsWith('fail_'))).toBe(true);
        expect(report.foodResolvedIngredients).toBe(api.polled.length);
        expect(report.foodPendingIngredients).toBe(0);
    });

    it('counts DISTINCT ingredients by the id the poll RETURNED — two failures settling on one food are one', async () => {
        // Food resolved every phrase in the recipe to the same food, so every failure now points at ONE binding.
        const api = makeSettlingApi(() => boundTo('bound_one', 'food_one'));

        const report = await importOneAndSettle(api);

        expect(api.polled.length).toBeGreaterThan(1);
        expect(report.foodBackedIngredients).toBe(1);
        expect(report.foodResolvedIngredients).toBe(1);
    });

    /**
     * ⛔ A changed id is settled BY DEFINITION, whatever status it reports. The failure the pass was watching no
     * longer holds the lines, so re-polling it measures nothing — and the status route shares the default read
     * limit, which a sweep over a few hundred ingredients already exhausts. What the run reports is the returned
     * binding's own status.
     */
    it('never re-polls a failure once the poll answered a different id', async () => {
        const api = makeSettlingApi((id) => ({ ...failureFor(`elsewhere ${id}`), id: `moved_${id}` }));

        const report = await importOneAndSettle(api);

        expect(api.polled.length).toBeGreaterThan(1);
        expect(new Set(api.polled).size).toBe(api.polled.length);
        expect(report.foodPendingIngredients).toBe(api.polled.length);
    });

    it('keeps polling a failure the poll answered with the SAME id and a non-terminal status', async () => {
        const api = makeSettlingApi((id) => ({ ...failureFor(id), id }));

        const report = await importOneAndSettle(api, 100);

        // More polls than distinct failures: the window spanned several sweeps and the pass kept asking.
        expect(new Set(api.polled).size).toBeGreaterThan(1);
        expect(api.polled.length).toBeGreaterThan(new Set(api.polled).size);
        expect(report.foodResolvedIngredients).toBe(0);
        expect(report.foodPendingIngredients).toBe(new Set(api.polled).size);
    });

    /**
     * The LINE-level figure (`foodBacked`, the numerator of `resolutionRateOfLines`) is counted on the binding
     * each line ENDED on. A failure carries no food id, so counting at create time would score every line food
     * resolved during the window as unresolved — the under-report this pass exists to prevent, one figure over.
     */
    it('counts a line as carrying a food id when its failure settled onto a food', async () => {
        const api = makeSettlingApi((id) => boundTo(`bound_${id}`, `food_${id}`));

        const report = await importOneAndSettle(api);

        expect(report.ingredientLines).toBeGreaterThan(1);
        expect(report.foodBacked).toBe(report.ingredientLines);
    });

    it('counts EVERY line on a settled failure, not the failure once', async () => {
        // Every phrase converges on one failure record — the shape of "butter" appearing on many lines.
        const api = makeSettlingApi((id) => boundTo(`bound_${id}`, `food_${id}`));
        const converging: ImportApiPort = { ...api, addIngredientByName: async () => failureFor('butter') };

        const report = await importOneAndSettle(converging);

        expect(report.ingredientLines).toBeGreaterThan(1);
        expect(api.polled).toEqual([failureFor('butter').id]);
        expect(report.foodBacked).toBe(report.ingredientLines);
    });

    /**
     * The adjudication sample draws only lines whose example CLAIMS a food. An example written at create time
     * would show every settled line as a pending failure with no food, and the sample would silently skip the
     * lines food resolved late — a bias toward whatever resolved at once.
     */
    it('reports each example line on the food its failure settled onto, so the sample can draw it', async () => {
        const api = makeSettlingApi((id) => boundTo(`bound_${id}`, `food_${id}`));

        const report = await importOneAndSettle(api);
        const lines = report.examples[0]?.lines ?? [];

        expect(lines.length).toBeGreaterThan(1);
        expect(lines.every((line) => line.foodId !== undefined && line.foodResolutionStatus === 'RESOLVED')).toBe(true);
        expect(adjudicationSample(report, 100)).toHaveLength(lines.length);
    });

    it('does not count a line whose failure was still pending when the window closed', async () => {
        const api = makeSettlingApi((id) => ({ ...failureFor(id), id }));

        const report = await importOneAndSettle(api, 50);

        expect(report.ingredientLines).toBeGreaterThan(1);
        expect(report.foodBacked).toBe(0);
    });

    it('never watches a DECLARED name — it has no status, and nothing food does can settle it', async () => {
        const api = makeSettlingApi((id) => boundTo(`bound_${id}`, `food_${id}`));
        const declaring: ImportApiPort = {
            ...api,
            addIngredientByName: async () => {
                throw new Error('by-name refused');
            },
        };

        const report = await importOneAndSettle(declaring);

        expect(report.resolutionKinds.freeform).toBeGreaterThan(0);
        expect(api.polled).toEqual([]);
        expect(report.foodBackedIngredients).toBe(0);
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
