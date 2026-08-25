/**
 * Integration tier — THE PIPELINE OVER THE REAL PYTHON CRF (plan U22, phase 5).
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | U22 — the real CRF adapter satisfies the port | "the real engine answers every line" |
 * | KTD-13 — the engine version is the one actually installed | "the version it reports" |
 * | KTD-12 — a model leg that cannot answer yields `single-engine`, never `differ` | "one engine silent" |
 * | ADR-0026 — the CRF loses a historical unit into the food name | "the gill the CRF cannot see" |
 * | U22 — a warm cache serves the whole batch with no engine call | "the second run calls nothing" |
 *
 * What this tier proves that the unit tier structurally cannot:
 *
 *  1. **The real `ingredient-parser-nlp` CRF model runs**, through the real Python process, over lines out of
 *     the committed 1919 excerpt. A fake sidecar proves only that we can read our own fixture.
 *  2. **The version the adapter reports is the one pip actually installed**, read from the same interpreter
 *     that ran the parse — the fact `ingredient_parse_cache`'s key depends on and that no fake can supply.
 *  3. **The two legs compose into the comparator.** The unit tier promotes each engine separately; only this
 *     one takes a real CRF reading, an independently produced model reading, and the real adjudication.
 *
 * ⚠️ Skipped (not failed) when `python3 -c "import ingredient_parser"` does not succeed, mirroring
 * `crfParse.integration.test.ts`. CI installs the pinned engine, so CI runs it.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import {
    NO_CACHE,
    NO_CORRECTIONS,
    promoteLlmParse,
    runParsePipeline,
    type CachedParseRow,
    type EngineAnswer,
    type ParseCachePort,
    type ParseEnginePort,
    type ParsePipelineDeps,
    type ParsePipelineOutcome,
    type ParsePipelineTier,
    type RememberedParse,
    type UnreadablePayload,
} from '@kitchensink/recipe-import-core';
import type { HexDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import { describe, expect, it } from 'vitest';

import { createCrfEngine } from '../src/parsing/crfEngine.js';

/** The real hash, so the keys here are the keys the table would hold. */
const sha256: HexDigest = (value) => createHash('sha256').update(value).digest('hex');

/**
 * Lines from the committed 1919 excerpt, chosen so each names a fact this tier is about.
 *
 * ⚠️ Real corpus text, not invented phrases. The gill line is the one ADR-0026 names as the CRF's known
 * blindness, and it is the reason the comparator has a rescue rule at all.
 */
const LINES: readonly string[] = [
    'one cup of brown sugar',
    'one-half cup of butter',
    'two cups of flour',
    'one gill of milk',
    '3 cloves garlic, minced',
];

function crfIsInstalled(): boolean {
    try {
        execFileSync('python3', ['-c', 'import ingredient_parser'], { stdio: 'ignore' });

        return true;
    } catch {
        return false;
    }
}

const describeIfInstalled = crfIsInstalled() ? describe : describe.skip;

/** A model leg that reads each line the way a compliant answer would, with no network. */
function stubbedModel(readings: ReadonlyMap<string, { measure: string | null; name: string }>): ParseEnginePort<'llm'> {
    return {
        engine: 'llm',
        engineVersion: 'amazon.nova-micro-v1:0@v1',
        async parse(lines): Promise<readonly EngineAnswer[]> {
            return lines.map((line) => {
                const reading = readings.get(line);

                // ⛔ ABSENCE, never a `ParsedLine` with empty fields: "the model had no opinion" and "the
                // model read the line and found no food" are different facts (KTD-12).
                return reading === undefined
                    ? { unavailable: true }
                    : promoteLlmParse(
                          { statedMeasure: reading.measure, foods: [{ name: reading.name, prep: null }] },
                          line,
                      );
            });
        },
    };
}

/** A cache that behaves like the COLUMN: every payload crosses `JSON`, exactly as `jsonb` makes it. */
function makeJsonCache(): ParseCachePort & { readonly writes: RememberedParse[] } {
    const rows = new Map<string, { row: Omit<CachedParseRow, 'parse'>; parse: string }>();
    const writes: RememberedParse[] = [];

    return {
        writes,
        async findForLines(digests): Promise<readonly CachedParseRow[]> {
            return [...rows.values()]
                .filter((held) => digests.includes(held.row.lineDigest))
                .map((held) => ({ ...held.row, parse: JSON.parse(held.parse) as unknown }));
        },
        async remember(entry): Promise<void> {
            writes.push(entry);

            if (!rows.has(entry.parseKey)) {
                rows.set(entry.parseKey, {
                    row: { lineDigest: entry.lineDigest, engine: entry.engine, engineVersion: entry.engineVersion },
                    parse: JSON.stringify(entry.parse),
                });
            }
        },
    };
}

/** A collector for everything a run reported. */
function makeObservers(): {
    readonly tierFailures: ParsePipelineTier[];
    readonly unreadable: UnreadablePayload[];
    readonly onTierFailure: (tier: ParsePipelineTier) => void;
    readonly onUnreadablePayload: (payload: UnreadablePayload) => void;
} {
    const tierFailures: ParsePipelineTier[] = [];
    const unreadable: UnreadablePayload[] = [];

    return {
        tierFailures,
        unreadable,
        onTierFailure: (tier) => tierFailures.push(tier),
        onUnreadablePayload: (payload) => unreadable.push(payload),
    };
}

/** The agreement an outcome reports, or `undefined` for a correction, which structurally has none. */
function agreementOf(outcome: ParsePipelineOutcome): { kind: string } | undefined {
    return 'agreement' in outcome ? outcome.agreement : undefined;
}

describeIfInstalled('the parse pipeline over the real CRF engine', () => {
    it('reports the version pip actually installed, and it is the pinned one', async () => {
        const crf = await createCrfEngine();

        // ⚠️ Pinned to the MAJOR-MINOR the report was measured against rather than the exact patch, so a
        // patch bump is a visible re-partition (a new cache generation) rather than a red suite — while a
        // major bump, which would change what the model reads, still fails here.
        expect(crf.engineVersion).toMatch(/^ingredient-parser-nlp==2\.3\./u);
    }, 180_000);

    it('the real engine answers every line, and the two legs adjudicate', async () => {
        const crf = await createCrfEngine();
        const llm = stubbedModel(
            new Map([
                ['one cup of brown sugar', { measure: 'one cup', name: 'brown sugar' }],
                ['one-half cup of butter', { measure: 'one-half cup', name: 'butter' }],
                ['two cups of flour', { measure: 'two cups', name: 'flour' }],
                ['one gill of milk', { measure: 'one gill', name: 'milk' }],
                ['3 cloves garlic, minced', { measure: '3 cloves', name: 'garlic' }],
            ]),
        );
        const observers = makeObservers();
        const deps: ParsePipelineDeps = {
            corrections: NO_CORRECTIONS,
            cache: NO_CACHE,
            engines: { crf, llm },
            digest: sha256,
        };
        const outcomes = await runParsePipeline(LINES, deps, { ownerId: undefined }, observers);

        expect(observers.tierFailures).toEqual([]);
        expect(outcomes).toHaveLength(LINES.length);

        outcomes.forEach((outcome, index) => {
            expect(outcome.tier).toBe('parse');
            expect(outcome.parsed?.raw).toBe(LINES[index]);
            expect(agreementOf(outcome)?.kind).not.toBe('neither');
        });

        // Non-vacuity: a pipeline that resolved everything to nothing would satisfy the loop above.
        const sugar = outcomes[0]?.parsed;

        expect(sugar?.quantity).toEqual({ kind: 'exact', value: 1 });
        expect(sugar?.unit).toBe('cup');
    }, 180_000);

    it('the gill the CRF cannot see is RESCUED from the model, not reported as a disagreement', async () => {
        // ⛔ ADR-0026's measured blindness: the CRF is trained on modern text and folds `gill` into the food
        // name, reading a bare number. That is a KNOWN blindness, not dissent — so the model takes the measure
        // PHRASE and the UNIT, and the two facts it corrupts are silenced from the disagreement report.
        const crf = await createCrfEngine();
        const llm = stubbedModel(new Map([['one gill of milk', { measure: 'one gill', name: 'milk' }]]));
        const [outcome] = await runParsePipeline(
            ['one gill of milk'],
            { corrections: NO_CORRECTIONS, cache: NO_CACHE, engines: { crf, llm }, digest: sha256 },
            { ownerId: undefined },
            makeObservers(),
        );

        expect(outcome?.parsed?.unit).toBe('gill');
        expect(outcome?.parsed?.provenance.unit).toBe('llm');
        // ⛔ The CRF still owns the AMOUNT. Missing the unit does not stop it reading the leading number, and
        // a differing number would be a genuine disagreement that must be reported.
        expect(outcome?.parsed?.provenance.quantity).toBe('crf');
    }, 180_000);

    it('one engine silent is `single-engine`, never `differ`', async () => {
        const crf = await createCrfEngine();
        // An empty reading map means the model answers `unavailable` for every line.
        const llm = stubbedModel(new Map());
        const [outcome] = await runParsePipeline(
            ['two cups of flour'],
            { corrections: NO_CORRECTIONS, cache: NO_CACHE, engines: { crf, llm }, digest: sha256 },
            { ownerId: undefined },
            makeObservers(),
        );

        expect(agreementOf(outcome as ParsePipelineOutcome)).toEqual({ kind: 'single-engine', engine: 'crf' });
        expect(outcome?.parsed?.quantity).toEqual({ kind: 'exact', value: 2 });
    }, 180_000);

    it('the second run calls NOTHING, and reproduces the first exactly', async () => {
        // ⛔ The lossless-cache property, over the REAL engine and a real `JSON` round trip. `raw`,
        // `provenance` and `reviewReasons` are re-derived rather than stored; if that is wrong for even one
        // real CRF reading, the two runs differ here.
        const cache = makeJsonCache();
        const llm = stubbedModel(new Map(LINES.map((line) => [line, { measure: null, name: line }] as const)));
        const cold = await runParsePipeline(
            LINES,
            { corrections: NO_CORRECTIONS, cache, engines: { crf: await createCrfEngine(), llm }, digest: sha256 },
            { ownerId: undefined },
            makeObservers(),
        );

        expect(cache.writes).toHaveLength(LINES.length * 2);

        /** A CRF port that FAILS if it is consulted at all — the strongest form of "no engine was called". */
        const forbidden: ParseEnginePort<'crf'> = {
            engine: 'crf',
            engineVersion: (await createCrfEngine()).engineVersion,
            async parse(): Promise<readonly EngineAnswer[]> {
                throw new Error('the cache should have answered every line');
            },
        };
        const observers = makeObservers();
        const warm = await runParsePipeline(
            LINES,
            { corrections: NO_CORRECTIONS, cache, engines: { crf: forbidden, llm }, digest: sha256 },
            { ownerId: undefined },
            observers,
        );

        expect(observers.tierFailures).toEqual([]);
        expect(warm).toEqual(cold.map((outcome) => ({ ...outcome, fromCache: ['crf', 'llm'] })));
    }, 180_000);

    it('never writes the cook`s line into a stored row', async () => {
        const cache = makeJsonCache();
        const llm = stubbedModel(new Map([['one cup of brown sugar', { measure: 'one cup', name: 'brown sugar' }]]));

        await runParsePipeline(
            ['one cup of brown sugar'],
            { corrections: NO_CORRECTIONS, cache, engines: { crf: await createCrfEngine(), llm }, digest: sha256 },
            { ownerId: undefined },
            makeObservers(),
        );

        expect(cache.writes).not.toHaveLength(0);

        for (const write of cache.writes) {
            expect(write.parse).not.toHaveProperty('raw');
            expect(JSON.stringify(write.parse)).not.toContain('one cup of brown sugar');
        }
    }, 180_000);
});
