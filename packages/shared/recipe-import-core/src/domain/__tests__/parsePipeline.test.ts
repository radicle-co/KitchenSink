/**
 * THE ORDER, AND NOTHING BUT THE ORDER (plan U22, phase 4).
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | KTD-15 — a correction outranks the cache and both engines | "the order" |
 * | U22 — a cache hit calls no engine | "the cache tier" |
 * | U22 — both engines are invoked CONCURRENTLY, not sequentially | "the engines run together" |
 * | KTD-12 — an engine that failed is ABSENCE, never dissent | "an engine that could not answer" |
 * | KTD-13 — the cache is keyed on `(lineDigest, engine, engineVersion)` | "a row from another generation" |
 * | U20 — the write is per-engine, and only for a FRESH answer | "what the run remembers" |
 * | U10's containment rule — a tier that throws is contained and REPORTED | "nothing takes a line down" |
 * | HAZ-041 — `raw` is each line's own text, byte-identical | "raw is each position's OWN line" |
 *
 * ⚠️ Two mutants this suite exists to catch, named so a future reader can check they still are:
 *
 *  1. `Promise.allSettled` → `Promise.all` in `consultEngines`. One engine's rejection would then discard
 *     the OTHER engine's good answer and take the whole batch down. Caught by "one engine rejecting does
 *     not lose the other".
 *  2. Steps 1 and 2 swapped, so the cache is consulted before corrections. A human's correction would then
 *     lose to a cached machine parse — "a correction that does nothing". Caught by "a correction outranks
 *     a cached parse", which asserts BOTH the value and that the cache was never asked.
 *
 * ⚠️ The concurrency test uses a MUTUAL barrier rather than a timer: each engine's fake blocks until the
 * OTHER has been entered, so a sequential implementation does not merely run slower — it never resolves,
 * and the test fails on its own timeout rather than on a wall-clock threshold that a loaded machine could
 * flake on.
 */
import { createHash } from 'node:crypto';

import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';
import {
    lineDigest,
    parseKey,
    type HexDigest,
    type LineDigest,
    type ParseEngine,
} from '@kitchensink/recipe-core/parsing/parse-key';
import { describe, it, expect } from 'vitest';

import {
    NO_CACHE,
    NO_CORRECTIONS,
    runParsePipeline,
    type CachedParseRow,
    type ParseCachePort,
    type ParseCorrectionsPort,
    type ParseEnginePort,
    type ParseEnginePorts,
    type ParsePipelineDeps,
    type ParsePipelineOutcome,
    type ParsePipelineTier,
    type RememberedParse,
    type UnreadablePayload,
} from '../parsePipeline.js';
import { storedFactsOf } from '../storedParseFacts.js';
import type { EngineAnswer } from '../parseComparator.js';
import type { ParsedFacts, ParsedLine } from '../../parsedLine.js';

/** The real derivation, so the keys this suite asserts are the keys the table would hold. */
const sha256: HexDigest = (value) => createHash('sha256').update(value).digest('hex');

const CRF_VERSION = 'ingredient-parser-nlp==2.3.0';
const LLM_VERSION = 'amazon.nova-micro-v1:0@v1';

const BUTTER = '1 tablespoon butter, melted';
const SUGAR = '2 cups sugar';

/** A parse attributed wholly to one reader. */
function makeParse(engine: ParseEngine, overrides: Partial<ParsedFacts> = {}, raw = BUTTER): ParsedLine {
    return {
        raw,
        statedMeasure: '1 tablespoon',
        quantity: { kind: 'exact', value: 1 },
        unit: 'tablespoon',
        foods: [{ name: 'butter', prep: 'melted' }],
        ...overrides,
        reviewReasons: [],
        provenance: { statedMeasure: engine, quantity: engine, unit: engine, foods: engine },
    };
}

/** How one engine behaves in a test. */
interface EngineBehaviour {
    /** Answer a specific line with this, instead of the default parse. */
    readonly answers?: ReadonlyMap<string, EngineAnswer>;
    /** Reject the whole batch. */
    readonly rejectWith?: Error;
    /** Answer with this many entries regardless of how many were asked — the mispairing case. */
    readonly answerCount?: number;
    /** Block until this settles, so concurrency can be observed. */
    readonly gate?: () => Promise<void>;
}

/** An engine port that records every batch it was given. */
function makeEngine<E extends ParseEngine>(
    engine: E,
    behaviour: EngineBehaviour = {},
): ParseEnginePort<E> & { readonly batches: (readonly string[])[] } {
    const batches: (readonly string[])[] = [];

    return {
        batches,
        engine,
        engineVersion: engine === 'crf' ? CRF_VERSION : LLM_VERSION,
        async parse(lines): Promise<readonly EngineAnswer[]> {
            batches.push(lines);
            await behaviour.gate?.();

            if (behaviour.rejectWith !== undefined) {
                throw behaviour.rejectWith;
            }

            const answers = lines.map(
                (line): EngineAnswer => behaviour.answers?.get(line) ?? makeParse(engine, {}, line),
            );

            return behaviour.answerCount === undefined ? answers : answers.slice(0, behaviour.answerCount);
        },
    };
}

/** Both engines, wired under the keys their own `engine` value names. */
function makeEngines(
    crf: ParseEnginePort<'crf'> = makeEngine('crf'),
    llm: ParseEnginePort<'llm'> = makeEngine('llm'),
): ParseEnginePorts {
    return { crf, llm };
}

/** A cache holding whatever rows a test seeds, recording every read and write. */
function makeCache(rows: readonly CachedParseRow[] = []): ParseCachePort & {
    readonly reads: (readonly LineDigest[])[];
    readonly writes: RememberedParse[];
    failReadWith?: Error;
    failWriteWith?: Error;
} {
    const reads: (readonly LineDigest[])[] = [];
    const writes: RememberedParse[] = [];

    return {
        reads,
        writes,
        async findForLines(digests): Promise<readonly CachedParseRow[]> {
            reads.push(digests);

            if (this.failReadWith !== undefined) {
                throw this.failReadWith;
            }

            return rows.filter((row) => digests.includes(row.lineDigest));
        },
        async remember(entry): Promise<void> {
            if (this.failWriteWith !== undefined) {
                throw this.failWriteWith;
            }

            writes.push(entry);
        },
    };
}

/** A correction tier keyed the way the DAL is, recording what it was asked. */
function makeCorrections(entries: ReadonlyMap<string, unknown> = new Map()): ParseCorrectionsPort & {
    readonly asked: { key: string; userId: string | undefined }[];
    failWith?: Error;
} {
    const asked: { key: string; userId: string | undefined }[] = [];

    return {
        asked,
        async findInForce(key, userId): Promise<{ readonly facts: unknown } | undefined> {
            asked.push({ key, userId });

            if (this.failWith !== undefined) {
                throw this.failWith;
            }

            return entries.has(key) ? { facts: entries.get(key) } : undefined;
        },
    };
}

/** Everything a run needs, with every port a recording double unless a test replaces one. */
function makeDeps(overrides: Partial<ParsePipelineDeps> = {}): ParsePipelineDeps {
    return {
        corrections: makeCorrections(),
        cache: makeCache(),
        engines: makeEngines(),
        digest: sha256,
        ...overrides,
    };
}

/** A collector for everything the run reported. */
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

/** The digest the run will key a line under. */
function digestOf(line: string): LineDigest {
    return lineDigest(line, sha256);
}

/** One seeded cache row. */
function makeRow(line: string, engine: ParseEngine, parse: unknown, engineVersion?: string): CachedParseRow {
    return {
        lineDigest: digestOf(line),
        engine,
        engineVersion: engineVersion ?? (engine === 'crf' ? CRF_VERSION : LLM_VERSION),
        parse,
    };
}

/** The one outcome for a single-line batch. */
function only(outcomes: readonly ParsePipelineOutcome[]): ParsePipelineOutcome {
    expect(outcomes).toHaveLength(1);

    return outcomes[0] as ParsePipelineOutcome;
}

/** The agreement an outcome reports, or `undefined` when it is a correction and structurally has none. */
function agreementOf(outcome: ParsePipelineOutcome): unknown {
    return 'agreement' in outcome ? outcome.agreement : undefined;
}

describe('the order: corrections, then the cache, then the engines', () => {
    it('a correction outranks a cached parse — and the cache is never even asked', async () => {
        // ⛔ THE SWAPPED-STEPS MUTANT. Both tiers hold an answer and they disagree; only the ORDER decides.
        const corrections = makeCorrections(
            new Map([
                [
                    normalizedIngredientKey(BUTTER) as string,
                    {
                        statedMeasure: 'two tablespoons',
                        quantity: { kind: 'exact', value: 2 },
                        unit: 'tablespoon',
                        foods: [{ name: 'sweet butter', prep: null }],
                    },
                ],
            ]),
        );
        const cache = makeCache([
            makeRow(BUTTER, 'crf', storedFactsOf(makeParse('crf'))),
            makeRow(BUTTER, 'llm', storedFactsOf(makeParse('llm'))),
        ]);
        const outcome = only(
            await runParsePipeline([BUTTER], makeDeps({ corrections, cache }), { userId: 'user_1' }, makeObservers()),
        );

        expect(outcome.tier).toBe('correction');
        expect(outcome.parsed?.quantity).toEqual({ kind: 'exact', value: 2 });
        expect(outcome.parsed?.foods).toEqual([{ name: 'sweet butter', prep: null }]);
        expect(cache.reads).toEqual([]);
        expect(cache.writes).toEqual([]);
    });

    it('a correction outranks both live engines', async () => {
        const corrections = makeCorrections(
            new Map([
                [normalizedIngredientKey(BUTTER) as string, storedFactsOf(makeParse('crf', { unit: 'teaspoon' }))],
            ]),
        );
        const crf = makeEngine('crf');
        const llm = makeEngine('llm');

        await runParsePipeline(
            [BUTTER],
            makeDeps({ corrections, engines: makeEngines(crf, llm) }),
            { userId: 'u' },
            makeObservers(),
        );

        expect(crf.batches).toEqual([]);
        expect(llm.batches).toEqual([]);
    });

    it('a corrected line contributes NOTHING to the batch below it', async () => {
        // The mixed batch is the interesting one: the corrected line must not appear in the cache read or
        // in either engine's batch, and the uncorrected one must still be parsed.
        const corrections = makeCorrections(
            new Map([[normalizedIngredientKey(BUTTER) as string, storedFactsOf(makeParse('crf'))]]),
        );
        const cache = makeCache();
        const crf = makeEngine('crf');
        const outcomes = await runParsePipeline(
            [BUTTER, SUGAR],
            makeDeps({ corrections, cache, engines: makeEngines(crf) }),
            { userId: 'u' },
            makeObservers(),
        );

        expect(outcomes.map((outcome) => outcome.tier)).toEqual(['correction', 'parse']);
        expect(cache.reads).toEqual([[digestOf(SUGAR)]]);
        expect(crf.batches).toEqual([[SUGAR]]);
    });

    it('attributes every fact of a correction to the PERSON, and reports NO agreement at all', async () => {
        // ⛔ KTD-12 one tier up: a person is not an adjudication, and the member is ABSENT rather than null
        // so a rate-counting consumer cannot fold a human answer into a measured rate by forgetting a check.
        const corrections = makeCorrections(
            new Map([[normalizedIngredientKey(BUTTER) as string, storedFactsOf(makeParse('crf'))]]),
        );
        const outcome = only(
            await runParsePipeline([BUTTER], makeDeps({ corrections }), { userId: 'u' }, makeObservers()),
        );

        expect(outcome.parsed?.provenance).toEqual({
            statedMeasure: 'correction',
            quantity: 'correction',
            unit: 'correction',
            foods: 'correction',
        });
        expect('agreement' in outcome).toBe(false);
        expect(agreementOf(outcome)).toBeUndefined();
    });

    it('asks the correction tier under each line`s normalized key and the caller`s identity', async () => {
        const corrections = makeCorrections();

        await runParsePipeline([BUTTER, SUGAR], makeDeps({ corrections }), { userId: 'user_1' }, makeObservers());

        expect(corrections.asked).toEqual([
            { key: normalizedIngredientKey(BUTTER), userId: 'user_1' },
            { key: normalizedIngredientKey(SUGAR), userId: 'user_1' },
        ]);
    });

    it('passes an unattended import`s ABSENT identity through, rather than inventing one', async () => {
        const corrections = makeCorrections();

        await runParsePipeline([BUTTER], makeDeps({ corrections }), { userId: undefined }, makeObservers());

        expect(corrections.asked[0]?.userId).toBeUndefined();
    });

    it('skips the correction tier for a line with no normalizable key at all', async () => {
        const corrections = makeCorrections();
        const outcome = only(
            await runParsePipeline(['   '], makeDeps({ corrections }), { userId: 'u' }, makeObservers()),
        );

        expect(corrections.asked).toEqual([]);
        expect(outcome.tier).toBe('parse');
    });

    it('falls through to the engines when the stored correction cannot be READ', async () => {
        const key = normalizedIngredientKey(BUTTER) as string;
        const corrections = makeCorrections(new Map([[key, { quantity: 2 }]]));
        const crf = makeEngine('crf');
        const observers = makeObservers();
        const outcome = only(
            await runParsePipeline(
                [BUTTER],
                makeDeps({ corrections, engines: makeEngines(crf) }),
                { userId: 'u' },
                observers,
            ),
        );

        expect(outcome.tier).toBe('parse');
        expect(crf.batches).toEqual([[BUTTER]]);
        // ⛔ An unreadable ROW is not a tier failure: the tier answered. Reporting it as one would make "the
        // store is down" and "one row is stale-shaped" the same alarm.
        expect(observers.tierFailures).toEqual([]);
        expect(observers.unreadable).toEqual([{ tier: 'corrections', normalizedKey: key }]);
    });

    it('an empty batch consults nothing at all', async () => {
        const corrections = makeCorrections();
        const cache = makeCache();
        const crf = makeEngine('crf');

        expect(
            await runParsePipeline(
                [],
                makeDeps({ corrections, cache, engines: makeEngines(crf) }),
                { userId: 'u' },
                makeObservers(),
            ),
        ).toEqual([]);
        expect(corrections.asked).toEqual([]);
        // ⚠️ `inArray(col, [])` renders `in ()`, which PostgreSQL REJECTS. The empty batch is a live path.
        expect(cache.reads).toEqual([]);
        expect(crf.batches).toEqual([]);
    });
});

describe('the cache tier', () => {
    it('a hit on BOTH engines resolves the line, calls no engine, and says so in the result', async () => {
        const cache = makeCache([
            makeRow(BUTTER, 'crf', storedFactsOf(makeParse('crf'))),
            makeRow(BUTTER, 'llm', storedFactsOf(makeParse('llm'))),
        ]);
        const crf = makeEngine('crf');
        const llm = makeEngine('llm');
        const outcome = only(
            await runParsePipeline(
                [BUTTER],
                makeDeps({ cache, engines: makeEngines(crf, llm) }),
                { userId: undefined },
                makeObservers(),
            ),
        );

        expect(crf.batches).toEqual([]);
        expect(llm.batches).toEqual([]);
        // ⛔ A property of the RESULT, not of a spy. The cache-hit rate is a number only this module can
        // report, and asserting it on a mock would couple the test to the implementation.
        expect('fromCache' in outcome && outcome.fromCache).toEqual(['crf', 'llm']);
        expect(agreementOf(outcome)).toEqual({ kind: 'agree' });
        expect(cache.writes).toEqual([]);
    });

    it('adjudicates two cached answers rather than serving one of them', async () => {
        const cache = makeCache([
            makeRow(BUTTER, 'crf', storedFactsOf(makeParse('crf', { unit: 'tablespoon' }))),
            makeRow(BUTTER, 'llm', storedFactsOf(makeParse('llm', { unit: 'teaspoon' }))),
        ]);
        const outcome = only(
            await runParsePipeline([BUTTER], makeDeps({ cache }), { userId: undefined }, makeObservers()),
        );

        expect(agreementOf(outcome)).toEqual({ kind: 'differ', fields: ['unit'] });
    });

    it('reads the cache under the line DIGESTS, never under the lines', async () => {
        const cache = makeCache();

        await runParsePipeline([BUTTER, SUGAR], makeDeps({ cache }), { userId: undefined }, makeObservers());

        expect(cache.reads).toEqual([[digestOf(BUTTER), digestOf(SUGAR)]]);
        expect(JSON.stringify(cache.reads)).not.toContain('butter');
    });

    it('a row from another ENGINE GENERATION is not a hit', async () => {
        // ⛔ KTD-13: the identity is `(lineDigest, engine, engineVersion)`. A reader that matched on the
        // engine alone would serve a parse produced by a model or a package that is no longer installed.
        const cache = makeCache([
            makeRow(BUTTER, 'crf', storedFactsOf(makeParse('crf')), 'ingredient-parser-nlp==2.2.0'),
            makeRow(BUTTER, 'llm', storedFactsOf(makeParse('llm'))),
        ]);
        const crf = makeEngine('crf');
        const llm = makeEngine('llm');
        const outcome = only(
            await runParsePipeline(
                [BUTTER],
                makeDeps({ cache, engines: makeEngines(crf, llm) }),
                { userId: undefined },
                makeObservers(),
            ),
        );

        expect(crf.batches).toEqual([[BUTTER]]);
        expect(llm.batches).toEqual([]);
        expect('fromCache' in outcome && outcome.fromCache).toEqual(['llm']);
    });

    it('a row whose payload cannot be READ is a miss, reported by IDENTITY, and never served', async () => {
        const cache = makeCache([
            makeRow(BUTTER, 'crf', { statedMeasure: '1 tablespoon', quantity: 1 }),
            makeRow(BUTTER, 'llm', storedFactsOf(makeParse('llm'))),
        ]);
        const crf = makeEngine('crf');
        const observers = makeObservers();

        await runParsePipeline(
            [BUTTER],
            makeDeps({ cache, engines: makeEngines(crf) }),
            { userId: undefined },
            observers,
        );

        expect(crf.batches).toEqual([[BUTTER]]);
        expect(observers.tierFailures).toEqual([]);
        expect(observers.unreadable).toEqual([
            { tier: 'cache', lineDigest: digestOf(BUTTER), engine: 'crf', engineVersion: CRF_VERSION },
        ]);
        // ⚠️ And the report carries no zod issue list, because those quote the payload — which holds food
        // names a cook typed. KTD-14 spent a whole table design keeping that text out of places like a log.
        expect(JSON.stringify(observers.unreadable)).not.toContain('butter');
    });

    it('a PARTIAL hit asks each engine only for the lines IT is missing', async () => {
        const cache = makeCache([
            makeRow(BUTTER, 'llm', storedFactsOf(makeParse('llm'))),
            makeRow(SUGAR, 'crf', storedFactsOf(makeParse('crf', {}, SUGAR))),
        ]);
        const crf = makeEngine('crf');
        const llm = makeEngine('llm');
        const outcomes = await runParsePipeline(
            [BUTTER, SUGAR],
            makeDeps({ cache, engines: makeEngines(crf, llm) }),
            { userId: undefined },
            makeObservers(),
        );

        // ⛔ REQUIRED, not merely permitted: `parseKey.ts` says a version bump leaves "every LLM row … to be
        // re-compared against the new pairing", and both-or-neither would discard the surviving half.
        expect(crf.batches).toEqual([[BUTTER]]);
        expect(llm.batches).toEqual([[SUGAR]]);
        expect(outcomes.map((outcome) => ('fromCache' in outcome ? outcome.fromCache : null))).toEqual([
            ['llm'],
            ['crf'],
        ]);
        expect(outcomes.map(agreementOf)).toEqual([{ kind: 'agree' }, { kind: 'agree' }]);
    });

    it('a cache read that THROWS does not take the batch down', async () => {
        const cache = makeCache();

        cache.failReadWith = new Error('connection reset');

        const crf = makeEngine('crf');
        const observers = makeObservers();
        const outcome = only(
            await runParsePipeline(
                [BUTTER],
                makeDeps({ cache, engines: makeEngines(crf) }),
                { userId: undefined },
                observers,
            ),
        );

        expect(outcome.tier).toBe('parse');
        expect(crf.batches).toEqual([[BUTTER]]);
        expect(observers.tierFailures).toEqual([{ tier: 'cache', error: cache.failReadWith }]);
        expect(observers.unreadable).toEqual([]);
    });
});

describe('the engines run together, not one after the other', () => {
    it('invokes both engines CONCURRENTLY', async () => {
        // ⛔ A MUTUAL barrier, not a timer: each engine blocks until the other has been entered. A
        // sequential implementation never resolves and fails on the suite's own timeout, rather than on a
        // wall-clock threshold a loaded machine could flake on.
        let releaseCrf = (): void => undefined;
        let releaseLlm = (): void => undefined;
        const crfEntered = new Promise<void>((resolve) => {
            releaseCrf = resolve;
        });
        const llmEntered = new Promise<void>((resolve) => {
            releaseLlm = resolve;
        });
        const crf = makeEngine('crf', {
            gate: async () => {
                releaseCrf();
                await llmEntered;
            },
        });
        const llm = makeEngine('llm', {
            gate: async () => {
                releaseLlm();
                await crfEntered;
            },
        });

        const outcomes = await runParsePipeline(
            [BUTTER],
            makeDeps({ engines: makeEngines(crf, llm) }),
            { userId: undefined },
            makeObservers(),
        );

        expect(outcomes).toHaveLength(1);
        expect(crf.batches).toEqual([[BUTTER]]);
        expect(llm.batches).toEqual([[BUTTER]]);
    });

    it('gives each engine the SOURCE lines, byte-identical', async () => {
        const raw = '  One  gill of milk  ';
        const crf = makeEngine('crf');
        const llm = makeEngine('llm');

        await runParsePipeline(
            [raw],
            makeDeps({ engines: makeEngines(crf, llm) }),
            { userId: undefined },
            makeObservers(),
        );

        expect(crf.batches).toEqual([[raw]]);
        expect(llm.batches).toEqual([[raw]]);
    });

    it('asks about a REPEATED line once, and still gives each position its OWN raw', async () => {
        // ⛔ The digest IS the definition of "the same line" — NFC, whitespace-collapsed, case-preserving —
        // so asking twice pays a second billed call for one question, and the LLM leg not being
        // deterministic could put two readings of one line into one recipe. But HAZ-041 is about the
        // STRING: two spellings that share a digest are still two strings, and each keeps its own.
        const spaced = '1  tablespoon  butter,  melted';
        const crf = makeEngine('crf');
        const llm = makeEngine('llm');
        const cache = makeCache();
        const outcomes = await runParsePipeline(
            [BUTTER, spaced, BUTTER],
            makeDeps({ cache, engines: makeEngines(crf, llm) }),
            { userId: undefined },
            makeObservers(),
        );

        expect(crf.batches).toEqual([[BUTTER]]);
        expect(llm.batches).toEqual([[BUTTER]]);
        expect(outcomes.map((outcome) => outcome.parsed?.raw)).toEqual([BUTTER, spaced, BUTTER]);
        expect(cache.writes).toHaveLength(2);
    });

    it('raw is each position`s OWN line on the merged parse', async () => {
        const outcomes = await runParsePipeline([BUTTER, SUGAR], makeDeps(), { userId: undefined }, makeObservers());

        expect(outcomes.map((outcome) => outcome.parsed?.raw)).toEqual([BUTTER, SUGAR]);
    });

    it('THROWS when an engine answers a different number of lines than it was asked', async () => {
        // ⛔ A contract violation, not a data condition. Every answer after the gap is paired with the wrong
        // line, and every figure derived from the batch still looks perfectly clean — the one failure
        // `crfProcess.ts` calls "silent and total".
        const crf = makeEngine('crf', { answerCount: 1 });

        await expect(
            runParsePipeline(
                [BUTTER, SUGAR],
                makeDeps({ engines: makeEngines(crf) }),
                { userId: undefined },
                makeObservers(),
            ),
        ).rejects.toThrow(/mispaired/u);
    });

    it('THROWS when an engine answers NOTHING at all, rather than reading it as absence', async () => {
        // ⛔ The hole an "answers.length > 0" guard would leave. An empty answer list is indistinguishable
        // from a rejected batch by length alone, so the check runs on the FULFILLED branch only — an
        // adapter that returns `[]` is mispaired, while an adapter that rejects is absent.
        const crf = makeEngine('crf', { answerCount: 0 });
        const observers = makeObservers();

        await expect(
            runParsePipeline([BUTTER], makeDeps({ engines: makeEngines(crf) }), { userId: undefined }, observers),
        ).rejects.toThrow(/mispaired/u);
        expect(observers.tierFailures).toEqual([]);
    });
});

describe('an engine that could not answer is ABSENCE, never dissent', () => {
    it('one engine rejecting does not lose the other engine`s answer', async () => {
        // ⛔ THE `Promise.all` MUTANT. With `Promise.all` the CRF's rejection propagates out of the run and
        // the model's perfectly good reading — already in hand — is discarded with the whole batch.
        const boom = new Error('crfParse.py exited 1');
        const crf = makeEngine('crf', { rejectWith: boom });
        const llm = makeEngine('llm', {
            answers: new Map([[BUTTER, makeParse('llm', { unit: 'teaspoon' })]]),
        });
        const observers = makeObservers();
        const outcome = only(
            await runParsePipeline(
                [BUTTER],
                makeDeps({ engines: makeEngines(crf, llm) }),
                { userId: undefined },
                observers,
            ),
        );

        expect(agreementOf(outcome)).toEqual({ kind: 'single-engine', engine: 'llm' });
        expect(outcome.parsed?.unit).toBe('teaspoon');
        expect(observers.tierFailures).toEqual([{ tier: 'crf', error: boom }]);
    });

    it('a rejected batch is absence for EVERY line in it, reported ONCE', async () => {
        // ADR-0026 predicts exactly this for a CRF leg that fails to import: `single-engine` on every line.
        const crf = makeEngine('crf', { rejectWith: new Error('ImportError') });
        const observers = makeObservers();
        const outcomes = await runParsePipeline(
            [BUTTER, SUGAR],
            makeDeps({ engines: makeEngines(crf) }),
            { userId: undefined },
            observers,
        );

        expect(outcomes.map(agreementOf)).toEqual([
            { kind: 'single-engine', engine: 'llm' },
            { kind: 'single-engine', engine: 'llm' },
        ]);
        expect(observers.tierFailures).toHaveLength(1);
    });

    it('a PER-LINE refusal is absence for that line only', async () => {
        const crf = makeEngine('crf', { answers: new Map([[SUGAR, { unavailable: true }]]) });
        const outcomes = await runParsePipeline(
            [BUTTER, SUGAR],
            makeDeps({ engines: makeEngines(crf) }),
            { userId: undefined },
            makeObservers(),
        );

        expect(outcomes.map(agreementOf)).toEqual([{ kind: 'agree' }, { kind: 'single-engine', engine: 'llm' }]);
    });

    it('is `single-engine` even when the survivor is the kind that WOULD have differed', async () => {
        const crf = makeEngine('crf', {
            answers: new Map([[BUTTER, makeParse('crf', { unit: 'teaspoon', quantity: { kind: 'absent' } })]]),
        });
        const llm = makeEngine('llm', { rejectWith: new Error('ceiling denied') });
        const outcome = only(
            await runParsePipeline(
                [BUTTER],
                makeDeps({ engines: makeEngines(crf, llm) }),
                { userId: undefined },
                makeObservers(),
            ),
        );

        expect(agreementOf(outcome)).toEqual({ kind: 'single-engine', engine: 'crf' });
    });

    it('both engines silent resolves NOTHING, and says so in the type', async () => {
        const crf = makeEngine('crf', { rejectWith: new Error('a') });
        const llm = makeEngine('llm', { rejectWith: new Error('b') });
        const observers = makeObservers();
        const outcome = only(
            await runParsePipeline(
                [BUTTER],
                makeDeps({ engines: makeEngines(crf, llm) }),
                { userId: undefined },
                observers,
            ),
        );

        expect(agreementOf(outcome)).toEqual({ kind: 'neither' });
        expect(outcome.parsed).toBeNull();
        expect(observers.tierFailures.map((failure) => failure.tier).sort()).toEqual(['crf', 'llm']);
    });
});

describe('what the run remembers', () => {
    it('writes ONE row per engine that answered, keyed the way the table is keyed', async () => {
        const cache = makeCache();
        const crfParse = makeParse('crf');
        const llmParse = makeParse('llm');
        const engines = makeEngines(
            makeEngine('crf', { answers: new Map([[BUTTER, crfParse]]) }),
            makeEngine('llm', { answers: new Map([[BUTTER, llmParse]]) }),
        );

        await runParsePipeline([BUTTER], makeDeps({ cache, engines }), { userId: undefined }, makeObservers());

        const digest = digestOf(BUTTER);

        expect(cache.writes).toEqual([
            {
                parseKey: parseKey({ lineDigest: digest, engine: 'crf', engineVersion: CRF_VERSION }, sha256),
                lineDigest: digest,
                engine: 'crf',
                engineVersion: CRF_VERSION,
                parse: storedFactsOf(crfParse),
            },
            {
                parseKey: parseKey({ lineDigest: digest, engine: 'llm', engineVersion: LLM_VERSION }, sha256),
                lineDigest: digest,
                engine: 'llm',
                engineVersion: LLM_VERSION,
                parse: storedFactsOf(llmParse),
            },
        ]);
    });

    it('never writes the cook`s line into the row', async () => {
        const cache = makeCache();

        await runParsePipeline([BUTTER], makeDeps({ cache }), { userId: undefined }, makeObservers());

        expect(cache.writes).not.toHaveLength(0);

        for (const write of cache.writes) {
            expect(JSON.stringify(write.parse)).not.toContain('butter, melted');
            expect(write.parse).not.toHaveProperty('raw');
        }
    });

    it('remembers ONLY the engine that answered', async () => {
        const cache = makeCache();
        const engines = makeEngines(makeEngine('crf', { rejectWith: new Error('down') }));

        await runParsePipeline([BUTTER], makeDeps({ cache, engines }), { userId: undefined }, makeObservers());

        expect(cache.writes.map((write) => write.engine)).toEqual(['llm']);
    });

    it('does not re-write a row it read out of the cache', async () => {
        const cache = makeCache([makeRow(BUTTER, 'llm', storedFactsOf(makeParse('llm')))]);

        await runParsePipeline([BUTTER], makeDeps({ cache }), { userId: undefined }, makeObservers());

        expect(cache.writes.map((write) => write.engine)).toEqual(['crf']);
    });

    it('remembers nothing at all when a correction answered', async () => {
        const cache = makeCache();
        const corrections = makeCorrections(
            new Map([[normalizedIngredientKey(BUTTER) as string, storedFactsOf(makeParse('crf'))]]),
        );

        await runParsePipeline([BUTTER], makeDeps({ cache, corrections }), { userId: 'u' }, makeObservers());

        expect(cache.writes).toEqual([]);
    });

    it('a write that THROWS is reported and does not fail the line', async () => {
        // The parse succeeded. Failing the line because the cache would not take it costs a correct answer
        // to save a future call — exactly backwards.
        const cache = makeCache();

        cache.failWriteWith = new Error('unique violation');

        const observers = makeObservers();
        const outcome = only(await runParsePipeline([BUTTER], makeDeps({ cache }), { userId: undefined }, observers));

        expect(agreementOf(outcome)).toEqual({ kind: 'agree' });
        expect(observers.tierFailures.map((failure) => failure.tier)).toEqual(['cache', 'cache']);
    });
});

describe('nothing takes a line down', () => {
    it('a correction tier that THROWS is contained and reported', async () => {
        const corrections = makeCorrections();

        corrections.failWith = new Error('connection reset');

        const observers = makeObservers();
        const outcome = only(await runParsePipeline([BUTTER], makeDeps({ corrections }), { userId: 'u' }, observers));

        expect(outcome.tier).toBe('parse');
        expect(observers.tierFailures).toEqual([{ tier: 'corrections', error: corrections.failWith }]);
    });

    it('an observer that throws degrades the signal, never the parse', async () => {
        const engines = makeEngines(makeEngine('crf', { rejectWith: new Error('down') }));
        const outcome = only(
            await runParsePipeline(
                [BUTTER],
                makeDeps({ engines }),
                { userId: undefined },
                {
                    onTierFailure: () => {
                        throw new Error('the logger is broken');
                    },
                    onUnreadablePayload: () => {
                        throw new Error('the logger is broken');
                    },
                },
            ),
        );

        expect(agreementOf(outcome)).toEqual({ kind: 'single-engine', engine: 'llm' });
    });
});

describe('the Null Objects', () => {
    it('NO_CORRECTIONS binds nobody, so every line reaches the engines', async () => {
        const crf = makeEngine('crf');
        const outcome = only(
            await runParsePipeline(
                [BUTTER],
                makeDeps({ corrections: NO_CORRECTIONS, engines: makeEngines(crf) }),
                { userId: 'u' },
                makeObservers(),
            ),
        );

        expect(outcome.tier).toBe('parse');
        expect(crf.batches).toEqual([[BUTTER]]);
    });

    it('NO_CACHE never hits and never refuses a write', async () => {
        const crf = makeEngine('crf');
        const outcome = only(
            await runParsePipeline(
                [BUTTER],
                makeDeps({ cache: NO_CACHE, engines: makeEngines(crf) }),
                { userId: undefined },
                makeObservers(),
            ),
        );

        expect(outcome.tier).toBe('parse');
        expect('fromCache' in outcome && outcome.fromCache).toEqual([]);
        expect(await NO_CACHE.findForLines([digestOf(BUTTER)])).toEqual([]);
    });

    it('both are frozen, because they are process-wide singletons', () => {
        expect(Object.isFrozen(NO_CACHE)).toBe(true);
        expect(Object.isFrozen(NO_CORRECTIONS)).toBe(true);
    });
});
