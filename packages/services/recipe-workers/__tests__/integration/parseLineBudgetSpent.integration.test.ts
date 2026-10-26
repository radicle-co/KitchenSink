/**
 * A CEILING DENIAL ON A PARSE-JOB LINE, across two deliveries of the same line through the REAL pipeline, parse-cache
 * port, gated spine and handler (ADR-0024 §3, ADR-0026 §3 as amended; owner ruling 2026-10-26).
 *
 * Mocked: the database (an in-memory stand-in for the three tables the handler touches), the CRF engine and Bedrock.
 * Real: `processParseLine`, `runParsePipeline`, the cache port, `gatedConverse` with the real reserve/deny branch, the
 * validated LLM engine and the comparator. The stored fact the paste-match review leaves is proved against a real database in `tests/e2e/verification/budgetSpent.e2e.test.ts`.
 *
 * Two properties only a two-delivery run can show:
 *  1. delivery 1, ceiling spent: the line lands the CRF reading alone and the CRF answer is cached, the LLM's absence is
 *     NOT, so
 *  2. delivery 2, ceiling back: the LLM is asked again for the same text and its answer is cached.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it, vi, type Mock } from 'vitest';
import { lineDigest as realLineDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import type { ParsedLine, ParseEnginePort } from '@kitchensink/recipe-import-core';

import { processParseLine, type ParseLineDeps } from '../../src/handlers/parseLine.js';

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const LINE = '2 cups all-purpose flour';
const MESSAGE = {
    jobId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    lineIndex: 0,
    sourceLine: LINE,
    lineDigest: realLineDigest(LINE, digest),
    userId: 'u-1',
    requestedAt: '2026-10-26T12:00:00.000Z',
};

const CRF_READING: ParsedLine = {
    raw: LINE,
    statedMeasure: '2 cups',
    quantity: { kind: 'exact', value: 2 },
    unit: 'cup',
    foods: [{ name: 'all-purpose flour', prep: null }],
    reviewReasons: [],
    provenance: { statedMeasure: 'crf', quantity: 'crf', unit: 'crf', foods: 'crf' },
};

const LLM_TEXT =
    '[{"food_items":["all-purpose flour"],"measurement":{"quantity":"2","unit":"cups","unit_type":"volume"},"preparations":null,"equipment":null}]';

/** An in-memory stand-in for the parse cache and the job line, answering the handler's statements by shape. */
function world() {
    const cache: { engine: string; params: unknown[] }[] = [];
    const landings: unknown[][] = [];
    const pool = {
        query: vi.fn().mockImplementation((text: string, params: unknown[]) => {
            if (/SELECT line_digest, engine/u.test(text)) {
                return Promise.resolve({
                    rows: cache.map((row) => ({
                        line_digest: row.params[1],
                        engine: row.params[2],
                        engine_version: row.params[3],
                        parse: JSON.parse(String(row.params[4])),
                    })),
                });
            }

            if (/INSERT INTO ingredient_parse_cache/u.test(text)) {
                cache.push({ engine: String(params[2]), params });

                return Promise.resolve({ rows: [], rowCount: 1 });
            }

            if (/FROM recipe_parse_jobs/u.test(text)) {
                return Promise.resolve({ rows: [{ attempts: 1 }], rowCount: 1 });
            }

            if (/UPDATE recipe_parse_job_lines/u.test(text)) {
                landings.push(params);

                return Promise.resolve({ rows: [], rowCount: 1 });
            }

            if (/INSERT INTO ingredient_parse_leases/u.test(text)) {
                return Promise.resolve({ rows: [{ fence: '2026-10-26 00:00:00+00' }], rowCount: 1 });
            }

            return Promise.resolve({ rows: [], rowCount: 0 });
        }),
    };

    return { pool, cache, landings };
}

function depsOver(pool: { query: Mock }, reserve: Mock) {
    const crf = {
        engine: 'crf',
        engineVersion: 'crf-test',
        parse: vi.fn().mockImplementation((lines: string[]) => Promise.resolve(lines.map(() => CRF_READING))),
    } as unknown as ParseEnginePort<'crf'>;
    const converse = vi.fn().mockResolvedValue({
        kind: 'answered',
        text: LLM_TEXT,
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    const deps: ParseLineDeps = {
        stage: 'prod',
        gated: {
            stage: 'prod',
            deployRegion: 'us-east-1',
            settings: {
                resolve: vi.fn().mockResolvedValue({ ceilingMicros: 100_000_000, modelId: 'amazon.nova-micro-v1:0' }),
            },
            ledger: { reserve, settle: vi.fn().mockResolvedValue(undefined) },
            bedrock: { converse },
            emit: vi.fn(),
            now: () => new Date('2026-10-26T12:00:01.000Z'),
        },
        crf,
        pool,
        digest,
        emit: vi.fn(),
        parseModelId: 'amazon.nova-micro-v1:0',
        claimLeaseSeconds: 150,
        deliveryAllowance: 20,
        sleep: () => Promise.resolve(),
    };

    return { deps, converse };
}

describe('a ceiling denial on a parse-job line, across two deliveries', () => {
    it('⛔ lands the CRF reading alone and caches only the CRF answer; once the budget is back, the LLM is asked again', async () => {
        const { pool, cache, landings } = world();

        // Delivery 1: the ceiling refuses every reservation.
        const spent = depsOver(pool, vi.fn().mockResolvedValue({ kind: 'denied', period: '2026-10' }));
        await expect(processParseLine(spent.deps, MESSAGE)).resolves.toBeUndefined();

        expect(spent.converse).not.toHaveBeenCalled();
        expect(landings).toHaveLength(1);
        expect(landings[0]?.[3]).toBe('parsed');
        expect(JSON.parse(String(landings[0]?.[4])).provenance.foods).toBe('crf');
        expect(cache.map((row) => row.engine)).toStrictEqual(['crf']);

        // Delivery 2 (a later job for the same text): the budget is back.
        const back = depsOver(pool, vi.fn().mockResolvedValue({ kind: 'reserved', reservedMicros: 100 }));
        await processParseLine(back.deps, MESSAGE);

        expect(back.converse).toHaveBeenCalled();
        expect(cache.map((row) => row.engine).sort()).toStrictEqual(['crf', 'llm']);
    });
});
