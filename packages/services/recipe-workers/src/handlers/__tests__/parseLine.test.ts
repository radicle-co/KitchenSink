/**
 * The service parse leg (plan U8) — the transient/terminal split, R17's digest guard, and KTD-F's
 * cache-bounded redelivery, driven from fakes with no network and no spend.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import { lineDigest as realLineDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import { FOODNESS_MODEL_ID } from '@kitchensink/recipe-core/parsing/foodness-prompt';
import {
    NOVA_2_LITE_MODEL_ID,
    NOVA_LITE_MODEL_ID,
    registryEntryFor,
    residencyClearance,
} from '@kitchensink/recipe-core/spend/spend-arithmetic';

import type { EngineAnswer, ParsedLine, ParseEnginePort } from '@kitchensink/recipe-import-core';

import { PARSE_LEG_MODEL_ID, landingOf, processParseLine, type ParseLineDeps } from '../parseLine.js';

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const LINE = '2 cups all-purpose flour';
const JOB = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const message = (overrides: Partial<Parameters<typeof processParseLine>[1]> = {}) => ({
    jobId: JOB,
    lineIndex: 0,
    sourceLine: LINE,
    lineDigest: digest(`v1:${LINE}`).slice(0, 64),
    userId: 'u-1',
    requestedAt: '2026-08-31T12:00:00.000Z',
    ...overrides,
});

const parsedLine = (foods: readonly string[]): ParsedLine => ({
    raw: LINE,
    statedMeasure: '2 cups',
    quantity: { kind: 'exact', value: 2 },
    unit: 'cup',
    foods: foods.map((name) => ({ name, prep: null })),
    reviewReasons: [],
    provenance: { statedMeasure: 'crf', quantity: 'crf', unit: 'crf', foods: 'crf' },
});

/** A fake engine answering every line with `answer` (or throwing). */
const engineOf = (
    engine: 'crf' | 'llm',
    answer: EngineAnswer | (() => never),
): ParseEnginePort<typeof engine> & { calls: string[][] } => {
    const calls: string[][] = [];

    return {
        engine,
        engineVersion: `${engine}-test`,
        calls,
        parse: vi.fn().mockImplementation((lines: string[]) => {
            calls.push(lines);

            if (typeof answer === 'function') {
                answer();
            }

            return Promise.resolve(lines.map(() => answer));
        }),
    } as never;
};

function build(overrides: Partial<ParseLineDeps> & { cacheRows?: unknown[]; llm?: unknown } = {}) {
    const queries: { text: string; params: unknown[] }[] = [];
    const pool = {
        query: vi.fn().mockImplementation((text: string, params: unknown[]) => {
            queries.push({ text, params });

            if (/SELECT line_digest/.test(text)) {
                return Promise.resolve({ rows: overrides.cacheRows ?? [] });
            }

            if (/UPDATE recipe_parse_job_lines/.test(text)) {
                return Promise.resolve({ rows: [], rowCount: 1 });
            }

            return Promise.resolve({ rows: [], rowCount: 0 });
        }),
    };
    const crf = engineOf('crf', parsedLine(['flour'])) as ParseEnginePort<'crf'> & {
        calls: string[][];
        parse: ReturnType<typeof vi.fn>;
    };
    // The gated deps are only consulted through the llm engine; the suite injects a fake llm engine by
    // overriding the pipeline through `gated` being unused — instead we pass a deps object whose gated
    // pieces are inert because the fake settings deny... simplest honest fake: settings that resolve and a
    // bedrock that answers.
    const deps: ParseLineDeps = {
        stage: 'prod',
        gated: {
            stage: 'prod',
            deployRegion: 'us-east-1',
            settings: {
                resolve: vi.fn().mockResolvedValue({ ceilingMicros: 100_000_000, modelId: 'amazon.nova-micro-v1:0' }),
            },
            ledger: { reserve: vi.fn().mockResolvedValue({ kind: 'reserved', reservedMicros: 100 }), settle: vi.fn() },
            bedrock: {
                converse: vi.fn().mockResolvedValue({
                    kind: 'answered',
                    text: '[]',
                    stopReason: 'end_turn',
                    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                }),
            },
            emit: vi.fn(),
            now: () => new Date('2026-08-31T12:00:01.000Z'),
        } as never,
        crf,
        pool: pool as never,
        digest,
        parseModelId: 'amazon.nova-micro-v1:0',
        ...overrides,
    };

    return { deps, pool, queries, crf };
}

describe('R17 — the digest guard', () => {
    it('⛔ a message whose digest does not match its line is DISCARDED — no engines, no landing', async () => {
        const { deps, pool, crf } = build({});

        await processParseLine(deps, message({ lineDigest: 'a'.repeat(64) }));

        expect(crf.parse).not.toHaveBeenCalled();
        expect(pool.query).not.toHaveBeenCalled();
    });

    it('the landing UPDATE is guarded on the recomputed digest', async () => {
        const { deps, queries } = build({});
        const m = { ...message(), lineDigest: computeRealDigest() };

        await processParseLine(deps, m);

        const landing = queries.find((query) => /UPDATE recipe_parse_job_lines/.test(query.text));

        expect(landing?.params?.[2]).toBe(computeRealDigest());
    });
});

/** The REAL digest the handler recomputes — derived through the same recipe-core function. */
function computeRealDigest(): string {
    return realLineDigest(LINE, digest);
}

describe('the exhaustion landing split (amended 2026-08-31)', () => {
    const base = {
        raw: LINE,
        statedMeasure: '2 cups',
        quantity: { kind: 'exact', value: 2 },
        unit: 'cup',
        provenance: { statedMeasure: 'llm', quantity: 'llm', unit: 'llm', foods: 'llm' },
        llmAttempts: 4,
    } as const;

    it("a MIXED-exhaustion line — kept foods beside a not_a_food record — lands 'parsed', not 'unparseable'", () => {
        const landing = landingOf({
            ...base,
            foods: [{ name: 'flour', prep: null }],
            reviewReasons: ['not_a_food'],
        });

        expect(landing.status).toBe('parsed');
    });

    it("an all-foods-refused exhaustion still lands 'unparseable' (R6)", () => {
        const landing = landingOf({ ...base, foods: [], reviewReasons: ['not_a_food'] });

        expect(landing.status).toBe('unparseable');
    });

    it("a measurement-only exhaustion lands 'parsed' with its review flag riding in the proposal", () => {
        const landing = landingOf({
            ...base,
            foods: [{ name: 'salt', prep: null }],
            reviewReasons: ['measurement_unverified'],
        });

        expect(landing.status).toBe('parsed');
        expect(landing.proposal?.reviewReasons).toContain('measurement_unverified');
    });
});

describe('the transient/terminal split', () => {
    it('⛔ a gated-leg throw re-throws AFTER the run, BEFORE any landing — the message redelivers', async () => {
        const { deps, queries } = build({});
        (deps.gated.ledger.reserve as ReturnType<typeof vi.fn>).mockResolvedValue({
            kind: 'denied',
            period: '2026-08',
        });

        await expect(processParseLine(deps, { ...message(), lineDigest: computeRealDigest() })).rejects.toThrow(
            /ceiling/,
        );
        expect(queries.some((query) => /UPDATE recipe_parse_job_lines/.test(query.text))).toBe(false);
    });

    it('⛔ a CRF INVOCATION failure is transient too — the line retries, it does not land single-engine', async () => {
        // ADR-0026's 2026-08-31 update lists "a CRF invocation failure" in the TRANSIENT set, beside the
        // ceiling denial and the Bedrock transport failure, on its own stated ground: none of them is
        // evidence about the ingredient, and "recording any of them as an outcome would turn an outage into
        // a permanent fact about a line".
        //
        // ⛔ The handler used to collect ONLY `tier === 'llm'`, so a line parsed during a CRF outage landed
        // the LLM's single-engine reading as its permanent answer — the outage becoming the fact. That is
        // the same argument this suite's gated-leg case above already makes, one engine over.
        const { deps, queries } = build({});

        (deps.crf.parse as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Function not found'));

        await expect(processParseLine(deps, { ...message(), lineDigest: computeRealDigest() })).rejects.toThrow(
            /Function not found/,
        );
        expect(queries.some((query) => /UPDATE recipe_parse_job_lines/.test(query.text))).toBe(false);
    });

    it('⛔ but a CRF ABSENCE that is not a failure still LANDS — ADR-0026 §3 is untouched', async () => {
        // THE NEGATIVE CONTROL for the case above, and the one that keeps the fix from over-reaching. A port
        // that RETURNS `{ unavailable: true }` said "I read this line and had no opinion" — the engine is
        // healthy. That is `single-engine`, a legitimate per-line outcome, and it lands. Treating every CRF
        // absence as transient would make every hard line retry to the DLQ, which is §3's "absence is not
        // dissent" broken in the opposite direction.
        const { deps, queries } = build({});

        (deps.crf.parse as ReturnType<typeof vi.fn>).mockImplementation((lines: string[]) =>
            Promise.resolve(lines.map(() => ({ unavailable: true }))),
        );

        await processParseLine(deps, { ...message(), lineDigest: computeRealDigest() });

        expect(queries.some((query) => /UPDATE recipe_parse_job_lines/.test(query.text))).toBe(true);
    });

    /**
     * ⛔ THE FOURTH CLASS — REFUSED (ADR-0024 §4b) — and it is neither of the two above.
     *
     * It shares the TRANSIENT set's rule that nothing may land: a merge produced while an engine was silenced
     * by a deployment fault must not become this line's permanent answer, which is the identical argument the
     * two CRF cases above make. It shares NONE of its rule that a retry might help: a residency refusal is
     * deterministic in (model, region), so re-throwing it would burn the queue's whole `maxReceiveCount` to
     * reach the same answer and would report a standing product decision as DLQ depth — the one signal
     * ADR-0024 layer 4 watches.
     *
     * ⚠️ It is also the case the "just return absence" design gets WRONG, silently: absence here would take
     * the negative-control path directly above and LAND a single-engine answer, green, for a config fault.
     */
    it('⛔ a RESIDENCY refusal lands nothing AND redelivers nothing — the fourth class', async () => {
        const { deps, queries } = build({ parseModelId: NOVA_2_LITE_MODEL_ID });

        await expect(
            processParseLine(deps, { ...message(), lineDigest: computeRealDigest() }),
        ).resolves.toBeUndefined();

        expect(queries.some((query) => /UPDATE recipe_parse_job_lines/.test(query.text))).toBe(false);
        expect(deps.gated.bedrock.converse).not.toHaveBeenCalled();
    });

    it('lets a residency refusal WIN over a concurrent transient failure — nothing can land either way', async () => {
        // ⚠️ Why the handler searches the whole collection rather than reading the first element: a run can
        // carry a CRF outage AND a refusal, and re-throwing the outage would put a permanently-failing
        // message onto the redelivery path for a fault redelivery cannot fix.
        const { deps, queries } = build({ parseModelId: NOVA_2_LITE_MODEL_ID });

        (deps.crf.parse as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Function not found'));

        await expect(
            processParseLine(deps, { ...message(), lineDigest: computeRealDigest() }),
        ).resolves.toBeUndefined();

        expect(queries.some((query) => /UPDATE recipe_parse_job_lines/.test(query.text))).toBe(false);
    });

    it('a STORE tier failure is NOT transient — a broken cache costs a call, never the line', async () => {
        // `corrections` and `cache` failures degrade into a re-parse, which is the pipeline's own rule
        // ("failing the line because the cache would not take it would cost a correct answer in order to
        // save a future call — exactly backwards"). Collecting every tier indiscriminately would make an
        // unreachable cache an outage.
        const { deps, queries, pool } = build({});

        pool.query.mockImplementation((text: string) => {
            if (/SELECT line_digest/.test(text)) {
                return Promise.reject(new Error('cache unreachable'));
            }

            if (/UPDATE recipe_parse_job_lines/.test(text)) {
                queries.push({ text, params: [] });

                return Promise.resolve({ rows: [], rowCount: 1 });
            }

            return Promise.resolve({ rows: [], rowCount: 0 });
        });

        await processParseLine(deps, { ...message(), lineDigest: computeRealDigest() });

        expect(queries.some((query) => /UPDATE recipe_parse_job_lines/.test(query.text))).toBe(true);
    });

    it('⛔ KTD-F: the surviving engine’s answer is CACHED before the re-throw', async () => {
        // This is what makes "an engine outage retries" affordable rather than a spend amplifier against
        // ADR-0024's one $100 pool: the redelivery re-reads whatever succeeded and re-pays only what did
        // not. Re-throwing before the pipeline's write-back would bill a fresh Bedrock call for every
        // redelivery of every line during a CRF outage.
        const { deps, queries } = build({});

        (deps.crf.parse as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Function not found'));
        (deps.gated.bedrock.converse as ReturnType<typeof vi.fn>).mockResolvedValue({
            kind: 'answered',
            // The wire shape `modelParseAnswerSchema` accepts: a ROOT ARRAY of relational records.
            text: JSON.stringify([
                {
                    food_items: ['flour'],
                    measurement: { quantity: '2', unit: 'cups', unit_type: 'volume' },
                    preparations: null,
                    equipment: null,
                },
            ]),
            stopReason: 'end_turn',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        });

        await expect(processParseLine(deps, { ...message(), lineDigest: computeRealDigest() })).rejects.toThrow();

        // The write-back is attempted for whatever answered, and it happens BEFORE the handler re-throws.
        expect(queries.some((query) => /INSERT INTO ingredient_parse_cache/.test(query.text))).toBe(true);
    });

    it('a clean run lands `parsed` with the merged proposal', async () => {
        const { deps, queries } = build({});

        await processParseLine(deps, { ...message(), lineDigest: computeRealDigest() });

        const landing = queries.find((query) => /UPDATE recipe_parse_job_lines/.test(query.text));

        expect(landing?.params?.[3]).toBe('parsed');
        expect(landing?.params?.[4]).toContain('flour');
    });

    it('updates the JOB aggregate after a landing', async () => {
        const { deps, queries } = build({});

        await processParseLine(deps, { ...message(), lineDigest: computeRealDigest() });

        expect(queries.some((query) => /UPDATE recipe_parse_jobs/.test(query.text))).toBe(true);
    });
});

/**
 * ⛔ EVERY MODEL THIS HANDLER PINS MUST BE RESIDENCY-CLEAR (ADR-0024 §4b) — the guard that turns a silent
 * degradation into a red build.
 *
 * The residency refusal is decided at RUNTIME by `planReservation`, and it does not fail the handler: the
 * line simply never lands, staying `pending` until its job's TTL sweeps it. That is the right disposition for
 * a deployment fault — and a terrible way to learn that the SHIPPED pin is unreachable, because the symptom
 * is a stalled import rather than an error. `PARSE_LEG_MODEL_ID` was `amazon.nova-2-lite-v1:0`, which is
 * `INFERENCE_PROFILE`-only over three regions and carries no warrant, so wiring residency in WITHOUT this
 * assertion would have shipped a parse leg that landed nothing at all and raised no test.
 *
 * ⚠️ The RULE is asserted, not the value: this stays green the day 016 warrants a cross-region model, and
 * goes red the moment a pin moves to one it has not.
 */
describe('the shipped model pins are callable', () => {
    it.each([
        ['parse leg', PARSE_LEG_MODEL_ID],
        ['foodness validator', FOODNESS_MODEL_ID],
    ])('%s pins a model residency clears', (_leg, modelId) => {
        const entry = registryEntryFor(modelId);

        if (entry === undefined) {
            throw new Error(`${modelId} is not in the registry at all`);
        }

        expect(residencyClearance(entry, 'us-east-1')).not.toBe('unapproved');
    });

    it('pins Nova Lite v1 for the parse leg — the residency-clear fallback from Nova 2 Lite', () => {
        // ⛔ A LITERAL on purpose. The assertion above proves the RULE holds; this one records WHICH model the
        // ruling landed on, so a change of parse model is a change of this line and shows up in the diff
        // beside whatever accuracy evidence justified it (ADR-0026 §9's gold set).
        expect(PARSE_LEG_MODEL_ID).toBe(NOVA_LITE_MODEL_ID);
    });
});

describe('KTD-F — the cache bounds redelivery amplification', () => {
    it('⛔ a redelivered line with BOTH engines cached calls NO engine at all', async () => {
        const storedDigest = realLineDigest(LINE, digest);
        const cachedFacts = {
            statedMeasure: '2 cups',
            quantity: { kind: 'exact', value: 2 },
            unit: 'cup',
            foods: [{ name: 'flour', prep: null }],
        };
        const { deps, crf } = build({
            cacheRows: [
                { line_digest: storedDigest, engine: 'crf', engine_version: 'crf-test', parse: cachedFacts },
                {
                    line_digest: storedDigest,
                    engine: 'llm',
                    engine_version: 'amazon.nova-micro-v1:0@v2',
                    parse: cachedFacts,
                },
            ],
        });

        await processParseLine(deps, { ...message(), lineDigest: storedDigest });

        expect(crf.parse).not.toHaveBeenCalled();
        expect(deps.gated.bedrock.converse).not.toHaveBeenCalled();
    });
});
