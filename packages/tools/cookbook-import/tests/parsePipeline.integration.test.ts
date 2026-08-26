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
 *  3. **U36's precondition is a fact about the ENGINE, not about a fixture** — that the real CRF names no
 *     unit at all on `one and a half quarts`, `one small onion` and `four large onions`. If it ever starts
 *     naming one, the rescue silently stops firing while every unit test still passes, so the CRF is asked
 *     on its own here and its silence asserted before the merged unit is looked at.
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
        const outcomes = await runParsePipeline(LINES, deps, { userId: undefined }, observers);

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
            { userId: undefined },
            makeObservers(),
        );

        expect(outcome?.parsed?.unit).toBe('gill');
        expect(outcome?.parsed?.provenance.unit).toBe('llm');
        // ⛔ REWRITTEN FOR U36a (2026-08-26). It asserted `provenance.quantity === 'crf'` — U36's half
        // rescue. The rescue now carries the whole measure, on the argument it already rested on: a CRF
        // that named no unit mis-segmented the phrase, so its number is residue rather than evidence.
        // ⚠️ Both engines read `one` here, so the VALUE is unchanged and only the attribution moves — which
        // is why the value is asserted too, rather than trusting the provenance to describe it.
        expect(outcome?.parsed?.provenance.quantity).toBe('llm');
        expect(outcome?.parsed?.quantity).toEqual({ kind: 'exact', value: 1 });
    }, 180_000);

    it('U36 — a MODERN unit and a SIZE word are rescued too, and mutual silence is not', async () => {
        // ⛔ THE RULING'S PRECONDITION, MEASURED HERE RATHER THAN QUOTED. Every unit assertion below is
        // worthless unless the real engine really does name no unit on these lines — and that is a claim
        // about a third-party model we neither own nor pin beyond a version string. So the CRF is asked
        // first, on its own, and its silence is asserted before the merge is looked at. Measured against
        // `ingredient-parser-nlp==2.3.0` on 2026-08-26, and reproduced by this test:
        //
        //   one and a half quarts of boiling water -> ('1',  '') name `boiling water`
        //   one small onion                        -> ('1',  '') name `small onion`   (size -> name, U16)
        //   four large onions                      -> ('4',  '') name `large onions`
        //   two eggs                               -> ('2',  '') name `eggs`
        //
        // ⛔ AND THE FIRST LINE'S NUMBER IS WRONG TOO — `1`, not `1.5`. Under U36 that stayed the CRF's and
        // the merged line stored ONE QUART against a source stating one and a half. The owner ruled that
        // out on 2026-08-26 ("blatantly incorrectly parsing measurement values"), so U36a takes the amount
        // with the rest of the measure. ⚠️ This test is where the CRF's `1` is PRODUCED rather than
        // assumed — the whole repair is invisible to any tier that writes that number into a fixture.
        const lines: readonly string[] = [
            'one and a half quarts of boiling water',
            'one small onion',
            'four large onions',
            'two eggs',
        ];
        const crf = await createCrfEngine();
        const crfAlone = await crf.parse(lines);

        expect(crfAlone.map((answer) => ('unavailable' in answer ? 'unavailable' : answer.unit))).toEqual([
            null,
            null,
            null,
            null,
        ]);
        // ⛔ THE DEFECT AT ITS SOURCE: the real engine reads one and a half quarts as a bare `1`.
        expect(crfAlone.map((answer) => ('unavailable' in answer ? 'unavailable' : answer.quantity))).toEqual([
            { kind: 'exact', value: 1 },
            { kind: 'exact', value: 1 },
            { kind: 'exact', value: 4 },
            { kind: 'exact', value: 2 },
        ]);

        const llm = stubbedModel(
            new Map([
                ['one and a half quarts of boiling water', { measure: 'one and a half quarts', name: 'boiling water' }],
                ['one small onion', { measure: 'one small', name: 'onion' }],
                ['four large onions', { measure: 'four large', name: 'onions' }],
                // ⛔ Bucket 1 — the model is silent about the unit TOO, so there is nothing to rescue.
                ['two eggs', { measure: 'two', name: 'eggs' }],
            ]),
        );
        const outcomes = await runParsePipeline(
            lines,
            { corrections: NO_CORRECTIONS, cache: NO_CACHE, engines: { crf, llm }, digest: sha256 },
            { userId: undefined },
            makeObservers(),
        );

        // ⛔ ONE table, so a merge that dropped every unit cannot pass by never being looked at. `quart`
        // and not `quarts`: `normalizeUnit` canonicalises, which a hand-written fixture would have hidden.
        expect(outcomes.map((outcome) => outcome.parsed?.unit ?? null)).toEqual(['quart', 'small', 'large', null]);
        expect(outcomes.map((outcome) => outcome.parsed?.provenance.unit)).toEqual(['llm', 'llm', 'llm', 'crf']);
        // ⛔ U36a — the amount travels WITH the rescued measure on the three rescued lines, and stays with
        // the CRF on the fourth, which was never rescued at all.
        expect(outcomes.map((outcome) => outcome.parsed?.provenance.quantity)).toEqual(['llm', 'llm', 'llm', 'crf']);
        // ⛔ THE REPAIR ITSELF, end to end over the REAL engine: `1.5`, not the CRF's `1`. Asserting the
        // provenance alone would pass on a merge that credited the LLM and stored the CRF's number.
        expect(outcomes.map((outcome) => outcome.parsed?.quantity)).toEqual([
            { kind: 'exact', value: 1.5 },
            { kind: 'exact', value: 1 },
            { kind: 'exact', value: 4 },
            { kind: 'exact', value: 2 },
        ]);
        // ⚠️ And the disagreement is still REPORTED on the line whose number moved — U36a changed what is
        // stored, never what is said about it.
        expect(agreementOf(outcomes[0])).toEqual({ kind: 'differ', fields: ['quantity'] });
    }, 180_000);

    it('one engine silent is `single-engine`, never `differ`', async () => {
        const crf = await createCrfEngine();
        // An empty reading map means the model answers `unavailable` for every line.
        const llm = stubbedModel(new Map());
        const [outcome] = await runParsePipeline(
            ['two cups of flour'],
            { corrections: NO_CORRECTIONS, cache: NO_CACHE, engines: { crf, llm }, digest: sha256 },
            { userId: undefined },
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
            { userId: undefined },
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
            { userId: undefined },
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
            { userId: undefined },
            makeObservers(),
        );

        expect(cache.writes).not.toHaveLength(0);

        for (const write of cache.writes) {
            expect(write.parse).not.toHaveProperty('raw');
            expect(JSON.stringify(write.parse)).not.toContain('one cup of brown sugar');
        }
    }, 180_000);
});
