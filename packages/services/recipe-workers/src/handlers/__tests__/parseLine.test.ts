/**
 * The service parse leg (plan U8) — the transient/terminal split, R17's digest guard, and KTD-F's
 * cache-bounded redelivery, driven from fakes with no network and no spend.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import { lineDigest as realLineDigest } from '@kitchensink/recipe-core/parsing/parse-key';

import type { EngineAnswer, ParsedLine, ParseEnginePort } from '@kitchensink/recipe-import-core';

import { landingOf, processParseLine, type ParseLineDeps } from '../parseLine.js';

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
