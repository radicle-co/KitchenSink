/**
 * Integration tier — THE WHOLE ORDER, over the REAL parsers and a REAL round trip through JSON (plan U22).
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | U22 — the pipeline resolves every line of the corpus in ONE batch | "a cold run over the corpus" |
 * | U20 / KTD-13 — a warm run is served entirely from the cache, calling NO engine | "a warm run" |
 * | U22 — nothing derivable is stored, so the cache is LOSSLESS | "a warm run reproduces the cold run" |
 * | KTD-14 — the cook's line never reaches a stored row | "no stored row carries the line" |
 * | KTD-15 — a correction outranks a warm cache | "a correction outranks a warm cache" |
 * | R19 — two spellings of one line COLLIDE on the correction key | "two spellings, one correction" |
 * | GR-007 — every value the pipeline resolves is storable by recipe-core's schemas | "downstream contract" |
 * | HAZ-041 — `raw` is the source line byte-identical | asserted on every line of the corpus |
 *
 * What this tier proves that the unit tier structurally cannot:
 *
 *  1. **The cache round trip crosses `JSON`.** The column is `jsonb`, so a payload is serialized and
 *     re-read — which drops `undefined` and cannot carry a `Map`, a `Date` or a class instance. The unit
 *     tier hands the same OBJECT back and would never see it.
 *  2. **The measure readings are the REAL `parse-ingredient`'s.** Rehydration RE-DERIVES `reviewReasons`
 *     from `statedMeasure` rather than storing them; whether that is lossless depends entirely on what the
 *     real parser does with 48 real 1919 phrases, and no fixture can answer it.
 *  3. **The keys are REAL SHA-256 digests** taken over the real preimages, so "one line, one digest" and
 *     "two lines, two digests" are properties of the derivation rather than of a fake.
 *  4. **The correction key is `recipe-core`'s**, across a package boundary — the collision that makes one
 *     cook's correction resolve another cook's line is the mechanism, and a stubbed key hides it.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { recipeIngredientNameSchema, recipeIngredientQuantitySchema } from '@kitchensink/recipe-core';
import type { HexDigest, LineDigest, ParseEngine } from '@kitchensink/recipe-core/parsing/parse-key';
import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';
import { describe, it, expect } from 'vitest';

import {
    NO_CACHE,
    NO_CORRECTIONS,
    promoteCrfReading,
    promoteLlmParse,
    runParsePipeline,
    type CachedParseRow,
    type CorrectionInForce,
    type CrfReading,
    type EngineAnswer,
    type ParseCachePort,
    type ParseCorrectionsPort,
    type ParsedLine,
    type ParseEnginePort,
    type ParseEnginePorts,
    type ParsePipelineDeps,
    type ParsePipelineOutcome,
    type ParsePipelineTier,
    type RememberedParse,
    type UnreadablePayload,
} from '../src/index.js';

import { GOLDEN_INGREDIENTS, type GoldenIngredient } from './__fixtures__/goldenCorpusParse.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS_MARKER = '--- CORPUS BEGINS ---';

/** The real hash the worker uses, so every key here is the key the table would hold. */
const sha256: HexDigest = (value) => createHash('sha256').update(value).digest('hex');

const CRF_VERSION = 'ingredient-parser-nlp==2.3.0';
const LLM_VERSION = 'amazon.nova-micro-v1:0@v1';

/**
 * The corpus slice with its provenance block stripped, line endings normalized to LF.
 *
 * ⚠️ Same reader as the two sibling tiers, and deliberately restated rather than shared: DAMP over DRY in
 * tests (CODING_STANDARDS §7), and a fixture reader extracted into a helper is a dependency between suites
 * that must be able to fail independently.
 */
function readCorpus(): string {
    const file = readFileSync(join(HERE, '__fixtures__', 'internationalJewishCookBook.txt'), 'utf8');
    const body = file.split(CORPUS_MARKER)[1];

    if (body === undefined) {
        throw new Error(`Corpus fixture is missing its "${CORPUS_MARKER}" marker.`);
    }

    return body.replace(/\r\n/g, '\n');
}

/** How the prose extractor hands a wrapped source phrase to a parser: one line, single-spaced. */
function asExtractedField(phrase: string): string {
    return phrase.replace(/\s+/g, ' ').trim();
}

/** Every hand-checked phrase, as the extractor hands them over — the batch the pipeline is given. */
const CORPUS_LINES: readonly string[] = GOLDEN_INGREDIENTS.map((golden) => asExtractedField(golden.phrase));

/**
 * The measure half of a hand-checked phrase — everything the hand-checked NAME is not.
 *
 * ⚠️ A trailing `of` goes with the measure: `"one cup of brown sugar"` states the measure `"one cup"`, and
 * the preposition belongs to neither half.
 *
 * @param golden - One hand-checked corpus phrase.
 * @returns The stated measure, or `''` when the phrase is all food. Pure.
 */
function statedMeasureOf(golden: GoldenIngredient): string {
    const line = asExtractedField(golden.phrase);

    return line
        .slice(0, line.length - golden.name.length)
        .trim()
        .replace(/\bof$/iu, '')
        .trim();
}

/** The CRF's row for a hand-checked phrase: the same measure and the same food, in the engine's shape. */
function asCrfRow(golden: GoldenIngredient): CrfReading {
    return {
        sentence: asExtractedField(golden.phrase),
        measure: statedMeasureOf(golden),
        names: [golden.name],
        size: null,
        preparation: null,
        comment: null,
    };
}

/**
 * A cache that behaves like the COLUMN: every payload crosses `JSON`, exactly as `jsonb` makes it.
 *
 * ⛔ The serialization is the point of this double. A cache that handed the same object back would prove
 * the round trip for a shape `JSON` cannot even carry.
 */
function makeJsonCache(): ParseCachePort & {
    readonly rows: Map<string, { engine: ParseEngine; engineVersion: string; parse: string; lineDigest: LineDigest }>;
    readonly writes: RememberedParse[];
    readonly reads: (readonly LineDigest[])[];
} {
    const rows = new Map<
        string,
        { engine: ParseEngine; engineVersion: string; parse: string; lineDigest: LineDigest }
    >();
    const writes: RememberedParse[] = [];
    const reads: (readonly LineDigest[])[] = [];

    return {
        rows,
        writes,
        reads,
        async findForLines(digests): Promise<readonly CachedParseRow[]> {
            reads.push(digests);

            return [...rows.values()]
                .filter((row) => digests.includes(row.lineDigest))
                .map((row) => ({
                    lineDigest: row.lineDigest,
                    engine: row.engine,
                    engineVersion: row.engineVersion,
                    parse: JSON.parse(row.parse) as unknown,
                }));
        },
        async remember(entry): Promise<void> {
            writes.push(entry);

            // ⛔ `DO NOTHING`, like the DAL: the FIRST parse of a generation stands. An overwriting cache
            // would let a row change under a comparison that already cited it.
            if (!rows.has(entry.parseKey)) {
                rows.set(entry.parseKey, {
                    engine: entry.engine,
                    engineVersion: entry.engineVersion,
                    lineDigest: entry.lineDigest,
                    parse: JSON.stringify(entry.parse),
                });
            }
        },
    };
}

/** Both engines, promoting hand-checked phrases through the REAL measure reader. */
function makeEngines(): ParseEnginePorts & {
    readonly crfBatches: (readonly string[])[];
    readonly llmBatches: (readonly string[])[];
} {
    const byLine = new Map(GOLDEN_INGREDIENTS.map((golden) => [asExtractedField(golden.phrase), golden]));
    const crfBatches: (readonly string[])[] = [];
    const llmBatches: (readonly string[])[] = [];

    const goldenFor = (sourceLine: string): GoldenIngredient => {
        const golden = byLine.get(sourceLine);

        if (golden === undefined) {
            throw new Error(`no hand-checked phrase for ${JSON.stringify(sourceLine)}`);
        }

        return golden;
    };

    const crf: ParseEnginePort<'crf'> = {
        engine: 'crf',
        engineVersion: CRF_VERSION,
        async parse(lines): Promise<readonly EngineAnswer[]> {
            crfBatches.push(lines);

            return lines.map((line) => promoteCrfReading(asCrfRow(goldenFor(line)), line));
        },
    };
    const llm: ParseEnginePort<'llm'> = {
        engine: 'llm',
        engineVersion: LLM_VERSION,
        async parse(lines): Promise<readonly EngineAnswer[]> {
            llmBatches.push(lines);

            return lines.map((line) => {
                const golden = goldenFor(line);
                const measure = statedMeasureOf(golden);

                return promoteLlmParse(
                    { statedMeasure: measure === '' ? null : measure, foods: [{ name: golden.name, prep: null }] },
                    line,
                );
            });
        },
    };

    return { crf, llm, crfBatches, llmBatches };
}

/** A collector for everything a run reported. Nothing here should ever report anything. */
function makeObservers(): {
    readonly tierFailures: { tier: ParsePipelineTier; error: unknown }[];
    readonly unreadable: UnreadablePayload[];
    readonly onTierFailure: (tier: ParsePipelineTier, error: unknown) => void;
    readonly onUnreadablePayload: (payload: UnreadablePayload) => void;
} {
    const tierFailures: { tier: ParsePipelineTier; error: unknown }[] = [];
    const unreadable: UnreadablePayload[] = [];

    return {
        tierFailures,
        unreadable,
        onTierFailure: (tier, error) => tierFailures.push({ tier, error }),
        onUnreadablePayload: (payload) => unreadable.push(payload),
    };
}

/** The agreement an outcome reports, or `undefined` when it is a correction and structurally has none. */
function agreementOf(outcome: ParsePipelineOutcome): unknown {
    return 'agreement' in outcome ? outcome.agreement : undefined;
}

describe('the golden corpus really is the corpus', () => {
    it('every hand-checked phrase occurs VERBATIM in the committed slice', () => {
        const corpus = asExtractedField(readCorpus());

        expect(GOLDEN_INGREDIENTS.length).toBeGreaterThan(20);

        for (const golden of GOLDEN_INGREDIENTS) {
            expect(corpus, golden.phrase).toContain(asExtractedField(golden.phrase));
        }
    });
});

describe('a cold run over the corpus, then a warm one', () => {
    it('resolves every line in ONE batch per engine, and reports nothing', async () => {
        const cache = makeJsonCache();
        const engines = makeEngines();
        const observers = makeObservers();
        const deps: ParsePipelineDeps = { corrections: NO_CORRECTIONS, cache, engines, digest: sha256 };
        const outcomes = await runParsePipeline(CORPUS_LINES, deps, { ownerId: undefined }, observers);

        expect(observers.tierFailures).toEqual([]);
        expect(observers.unreadable).toEqual([]);
        expect(outcomes).toHaveLength(CORPUS_LINES.length);

        // ⛔ ONE batch, not one call per line. `crfProcess.ts` records that per-line spawning "would turn a
        // two-second job into a quarter of an hour", and the Lambda's own contract calls an empty batch "a
        // caller defect (it costs a cold start to answer nothing)".
        expect(engines.crfBatches).toHaveLength(1);
        expect(engines.llmBatches).toHaveLength(1);
        expect(cache.reads).toHaveLength(1);

        for (const outcome of outcomes) {
            expect(outcome.tier).toBe('parse');
            expect(outcome.parsed).not.toBeNull();
            expect('fromCache' in outcome && outcome.fromCache).toEqual([]);
        }
    });

    it('a warm run reproduces the cold run EXACTLY, having called no engine at all', async () => {
        // ⛔ THE LOSSLESS-CACHE PROPERTY, over the real parser and a real `JSON` round trip. `raw`,
        // `provenance` and `reviewReasons` are all re-derived rather than stored; if that derivation is
        // wrong for even one of these 48 phrases, the two runs differ here. Nothing in the unit tier can
        // fail this test, because nothing there reads a real measure phrase.
        const cache = makeJsonCache();
        const cold = makeEngines();
        const observers = makeObservers();
        const coldOutcomes = await runParsePipeline(
            CORPUS_LINES,
            { corrections: NO_CORRECTIONS, cache, engines: cold, digest: sha256 },
            { ownerId: undefined },
            observers,
        );

        const warm = makeEngines();
        const warmOutcomes = await runParsePipeline(
            CORPUS_LINES,
            { corrections: NO_CORRECTIONS, cache, engines: warm, digest: sha256 },
            { ownerId: undefined },
            observers,
        );

        expect(warm.crfBatches).toEqual([]);
        expect(warm.llmBatches).toEqual([]);
        expect(observers.tierFailures).toEqual([]);
        expect(observers.unreadable).toEqual([]);
        expect(warmOutcomes).toEqual(
            coldOutcomes.map((outcome) => ({ ...outcome, fromCache: ['crf', 'llm'] as readonly ParseEngine[] })),
        );
    });

    it('stores exactly two rows per DISTINCT line, and NO stored row carries the cook`s line', async () => {
        const cache = makeJsonCache();
        const engines = makeEngines();

        await runParsePipeline(
            CORPUS_LINES,
            { corrections: NO_CORRECTIONS, cache, engines, digest: sha256 },
            { ownerId: undefined },
            makeObservers(),
        );

        expect(cache.rows.size).toBe(new Set(CORPUS_LINES).size * 2);

        // ⛔ KTD-14's whole argument: the digest is the only representation of the line in this table, which
        // is why the table has no owner column and is absent from the erasure sweep. A `raw` in the payload
        // would retire that argument silently.
        for (const row of cache.rows.values()) {
            expect(JSON.parse(row.parse)).not.toHaveProperty('raw');
            expect(row.lineDigest).toMatch(/^v\d+:[0-9a-f]{64}$/u);
        }

        for (const write of cache.writes) {
            expect(write.parseKey).toMatch(/^v\d+:[0-9a-f]{64}$/u);
        }
    });

    it('gives one line one digest and two lines two, across the whole corpus', async () => {
        const cache = makeJsonCache();
        const engines = makeEngines();

        await runParsePipeline(
            CORPUS_LINES,
            { corrections: NO_CORRECTIONS, cache, engines, digest: sha256 },
            { ownerId: undefined },
            makeObservers(),
        );

        // A collision here would serve one line's parse to another line — the worst cache hit available,
        // because it looks like a saving.
        expect(new Set([...cache.rows.values()].map((row) => row.lineDigest)).size).toBe(new Set(CORPUS_LINES).size);
    });
});

describe('downstream contract — every resolved value is storable', () => {
    it('satisfies the schemas that guard the persisted columns (GR-007)', async () => {
        const engines = makeEngines();
        const outcomes = await runParsePipeline(
            CORPUS_LINES,
            { corrections: NO_CORRECTIONS, cache: NO_CACHE, engines, digest: sha256 },
            { ownerId: undefined },
            makeObservers(),
        );

        outcomes.forEach((outcome, index) => {
            const parsed = outcome.parsed as ParsedLine;

            // HAZ-041 — byte-identical, on every line of the corpus.
            expect(parsed.raw).toBe(CORPUS_LINES[index]);

            // ⚠️ `recipeIngredientQuantitySchema` guards ONE BOUND — the `numeric(10,3)` column — not the
            // value object, so each bound is checked on its own, as the sibling promotion tier does.
            if (parsed.quantity.kind === 'exact') {
                expect(recipeIngredientQuantitySchema.safeParse(parsed.quantity.value).success).toBe(true);
            }

            if (parsed.quantity.kind === 'range') {
                expect(recipeIngredientQuantitySchema.safeParse(parsed.quantity.low).success).toBe(true);
                expect(recipeIngredientQuantitySchema.safeParse(parsed.quantity.high).success).toBe(true);
            }

            for (const food of parsed.foods) {
                expect(recipeIngredientNameSchema.safeParse(food.name).success, food.name).toBe(true);
            }
        });
    });

    it('reads the hand-checked amount and unit out of the real corpus phrases', async () => {
        // Non-vacuity: without this the suite above would pass against a pipeline that resolved every line
        // to an absent quantity and no unit.
        const engines = makeEngines();
        const outcomes = await runParsePipeline(
            CORPUS_LINES,
            { corrections: NO_CORRECTIONS, cache: NO_CACHE, engines, digest: sha256 },
            { ownerId: undefined },
            makeObservers(),
        );

        expect(outcomes.filter((outcome) => outcome.parsed?.quantity.kind === 'exact').length).toBeGreaterThan(
            CORPUS_LINES.length / 2,
        );

        outcomes.forEach((outcome, index) => {
            const golden = GOLDEN_INGREDIENTS[index] as GoldenIngredient;

            if (golden.quantity !== null) {
                expect(outcome.parsed?.quantity, golden.phrase).toEqual({ kind: 'exact', value: golden.quantity });
            }

            expect(outcome.parsed?.unit, golden.phrase).toBe(golden.unit);
            expect(agreementOf(outcome), golden.phrase).toEqual({ kind: 'agree' });
        });
    });
});

describe('the correction tier, over the REAL match grain', () => {
    /** The first hand-checked phrase, as the extractor hands it over. */
    const subject = CORPUS_LINES[0] as string;

    /** A correction store keyed the way `recipe-service`'s is, holding JSON exactly as `jsonb` does. */
    function makeJsonCorrections(entries: ReadonlyMap<string, string>): ParseCorrectionsPort & {
        readonly asked: string[];
    } {
        const asked: string[] = [];

        return {
            asked,
            async findInForce(key): Promise<CorrectionInForce | undefined> {
                asked.push(key);

                const stored = entries.get(key);

                return stored === undefined ? undefined : { facts: JSON.parse(stored) as unknown };
            },
        };
    }

    it('a correction outranks a WARM cache, and no engine and no cache read happen at all', async () => {
        const cache = makeJsonCache();
        const cold = makeEngines();

        await runParsePipeline(
            [subject],
            { corrections: NO_CORRECTIONS, cache, engines: cold, digest: sha256 },
            { ownerId: undefined },
            makeObservers(),
        );

        expect(cache.rows.size).toBe(2);

        const key = normalizedIngredientKey(subject) as string;
        const corrections = makeJsonCorrections(
            new Map([
                [
                    key,
                    JSON.stringify({
                        statedMeasure: 'one heaping cup',
                        quantity: { kind: 'exact', value: 1 },
                        unit: 'cup',
                        foods: [{ name: 'dark brown sugar', prep: null }],
                    }),
                ],
            ]),
        );
        const warm = makeEngines();
        const [outcome] = await runParsePipeline(
            [subject],
            { corrections, cache, engines: warm, digest: sha256 },
            { ownerId: undefined },
            makeObservers(),
        );

        expect(outcome?.tier).toBe('correction');
        expect(outcome !== undefined && 'agreement' in outcome).toBe(false);
        expect(outcome?.parsed?.foods).toEqual([{ name: 'dark brown sugar', prep: null }]);
        expect(outcome?.parsed?.raw).toBe(subject);
        expect(warm.crfBatches).toEqual([]);
        expect(warm.llmBatches).toEqual([]);
        expect(cache.reads).toHaveLength(1);
        expect(cache.rows.size).toBe(2);
    });

    it('two SPELLINGS of one line collide on the correction key — the mechanism R19 rests on', async () => {
        // The key destroys case and folds punctuation precisely so one cook's correction resolves another
        // cook's line. Stubbing the key in a unit test hides whether that collision actually happens.
        const key = normalizedIngredientKey(subject) as string;
        const corrections = makeJsonCorrections(
            new Map([
                [
                    key,
                    JSON.stringify({
                        statedMeasure: null,
                        quantity: { kind: 'absent' },
                        unit: null,
                        foods: [{ name: 'corrected food', prep: null }],
                    }),
                ],
            ]),
        );
        const engines = makeEngines();
        const shouted = subject.toUpperCase();

        // ⚠️ The SHOUTED spelling is not in the golden, so the engines would THROW if they were consulted —
        // which makes "the correction answered" load-bearing rather than incidental.
        const [outcome] = await runParsePipeline(
            [shouted],
            { corrections, cache: NO_CACHE, engines, digest: sha256 },
            { ownerId: 'user_1' },
            makeObservers(),
        );

        expect(corrections.asked).toEqual([key]);
        expect(outcome?.tier).toBe('correction');
        expect(outcome?.parsed?.raw).toBe(shouted);
        expect(outcome?.parsed?.foods).toEqual([{ name: 'corrected food', prep: null }]);
    });

    it('a correction from a SUPERSEDED shape is refused, reported by identity, and the engines answer', async () => {
        const key = normalizedIngredientKey(subject) as string;
        const corrections = makeJsonCorrections(new Map([[key, JSON.stringify({ quantity: 1, name: 'sugar' })]]));
        const engines = makeEngines();
        const observers = makeObservers();
        const [outcome] = await runParsePipeline(
            [subject],
            { corrections, cache: NO_CACHE, engines, digest: sha256 },
            { ownerId: 'user_1' },
            observers,
        );

        expect(outcome?.tier).toBe('parse');
        expect(observers.tierFailures).toEqual([]);
        expect(observers.unreadable).toEqual([{ tier: 'corrections', normalizedKey: key }]);
        expect(engines.crfBatches).toEqual([[subject]]);
    });

    it('a corrected line is EXCLUDED from the batch the engines are given', async () => {
        // The mixed batch is the one that matters: a correction must remove its line from every tier below
        // it, not merely win the comparison afterwards.
        const key = normalizedIngredientKey(subject) as string;
        const corrections = makeJsonCorrections(
            new Map([
                [
                    key,
                    JSON.stringify({
                        statedMeasure: null,
                        quantity: { kind: 'absent' },
                        unit: null,
                        foods: [{ name: 'corrected food', prep: null }],
                    }),
                ],
            ]),
        );
        const engines = makeEngines();
        const cache = makeJsonCache();
        const outcomes = await runParsePipeline(
            CORPUS_LINES,
            { corrections, cache, engines, digest: sha256 },
            { ownerId: 'user_1' },
            makeObservers(),
        );

        expect(outcomes[0]?.tier).toBe('correction');
        expect(engines.crfBatches[0]).not.toContain(subject);
        expect(engines.crfBatches[0]).toHaveLength(new Set(CORPUS_LINES).size - 1);
        expect(cache.reads[0]).not.toContain(subject);
    });
});
