/**
 * THE LOCAL PARSE LEG, from the offline model substitute to the line the editor saves (PR 132 device pass).
 *
 * The iOS pass ran against `npm run local:up`, whose parse worker answers the LLM leg with `localBedrockTransport.ts`.
 * Two pasted lines came back wrong there:
 *  - `1 1/2 cups whole milk` was saved and drawn as `1½ cups cups whole milk`: the substitute read the amount `1`,
 *    the unit `1/2` and the food `cups whole milk`, and the merge took the measure from the CRF and the foods from
 *    this leg.
 *  - `2-3 cups chicken stock` was saved as `2–3 cup`: the CRF's measure text is its own re-rendering, `2-3 cup`.
 *
 * Mocked: the database (an in-memory stand-in for the statements the handler issues) and the CRF engine, which answers
 * with the REAL rows `ingredient-parser-nlp` 2.3.0 gives these lines (measured 2026-11-06). Real: the substitute behind
 * the shipped `createBedrockConverseClient`, `gatedConverse` at a local (ungated) stage, the validated LLM engine,
 * `processParseLine`, `runParsePipeline`, both promotion adapters, the comparator, and recipe-core's `pastedLineRowOf`.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import { createBedrockConverseClient } from '@kitchensink/bedrock-client';
import { lineDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import { pastedLineRowOf } from '@kitchensink/recipe-core/parsing/pasted-line-measure';
import { promoteCrfReading, type CrfReading, type ParsedLine } from '@kitchensink/recipe-import-core';

import { processParseLine, type ParseLineDeps } from '../../src/handlers/parseLine.js';
import { createLocalBedrockTransport } from '../../src/local/localBedrockTransport.js';

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

/** The CRF's real answers to the two lines. */
const CRF_ROWS: Readonly<Record<string, CrfReading>> = {
    '1 1/2 cups whole milk': {
        sentence: '1 1/2 cups whole milk',
        measure: '1 1/2 cups',
        names: ['whole milk'],
        size: null,
        preparation: null,
        comment: null,
    },
    '2-3 cups chicken stock': {
        sentence: '2-3 cups chicken stock',
        measure: '2-3 cup',
        names: ['chicken stock'],
        size: null,
        preparation: null,
        comment: null,
    },
};

/** An in-memory stand-in for the parse cache and the job line, answering the handler's statements by shape. */
function world(): { readonly pool: ParseLineDeps['pool']; readonly landings: unknown[][] } {
    const landings: unknown[][] = [];
    const query = vi.fn().mockImplementation((text: string, params: unknown[]) => {
        if (/FROM recipe_parse_jobs/u.test(text)) {
            return Promise.resolve({ rows: [{ attempts: 1 }], rowCount: 1 });
        }

        if (/UPDATE recipe_parse_job_lines/u.test(text)) {
            landings.push(params);

            return Promise.resolve({ rows: [], rowCount: 1 });
        }

        if (/INSERT INTO ingredient_parse_leases/u.test(text)) {
            return Promise.resolve({ rows: [{ fence: '2026-11-06 00:00:00+00' }], rowCount: 1 });
        }

        return Promise.resolve({ rows: [], rowCount: 0 });
    });

    return { pool: { query }, landings };
}

/** The local parse leg's collaborators, as `localParseLine.ts` builds them, over the in-memory world. */
function localDeps(pool: ParseLineDeps['pool']): ParseLineDeps {
    return {
        stage: 'dev',
        gated: {
            stage: 'dev',
            deployRegion: 'us-east-1',
            settings: { resolve: async () => ({ ceilingMicros: 100_000_000, modelId: 'amazon.nova-micro-v1:0' }) },
            ledger: {
                reserve: vi.fn().mockResolvedValue({ kind: 'reserved', reservedMicros: 1 }),
                settle: vi.fn().mockResolvedValue(undefined),
            },
            bedrock: createBedrockConverseClient(createLocalBedrockTransport({ stage: 'dev' })),
            emit: vi.fn(),
            now: () => new Date('2026-11-06T12:00:00.000Z'),
        },
        crf: {
            engine: 'crf',
            engineVersion: 'ingredient-parser-nlp==2.3.0',
            parse: async (lines) =>
                lines.map((line) => {
                    const row = CRF_ROWS[line];

                    return row === undefined ? { unavailable: true } : promoteCrfReading(row, line);
                }),
        },
        pool,
        digest,
        emit: vi.fn(),
        parseModelId: 'amazon.nova-micro-v1:0',
        claimLeaseSeconds: 150,
        deliveryAllowance: 20,
        sleep: () => Promise.resolve(),
    };
}

/** Parse one line through the local leg and return the proposal it landed. */
async function landedProposal(line: string): Promise<ParsedLine> {
    const { pool, landings } = world();

    await processParseLine(localDeps(pool), {
        jobId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
        lineIndex: 0,
        sourceLine: line,
        lineDigest: lineDigest(line, digest),
        userId: 'u-1',
        requestedAt: '2026-11-06T12:00:00.000Z',
    });

    expect(landings).toHaveLength(1);
    expect(landings[0]?.[3]).toBe('parsed');

    return JSON.parse(String(landings[0]?.[4])) as ParsedLine;
}

describe('the local parse leg, from the offline substitute to the saved row', () => {
    it.each([
        ['1 1/2 cups whole milk', 'whole milk', { kind: 'exact', value: 1.5 }],
        ['2-3 cups chicken stock', 'chicken stock', { kind: 'range', low: 2, high: 3 }],
    ] as const)('saves %j with the food %j and the cook`s own unit, cups', async (line, name, quantity) => {
        const proposal = await landedProposal(line);
        const [food] = proposal.foods;

        expect(food?.name).toBe(name);
        expect(pastedLineRowOf(proposal, 0, food?.name ?? '')).toEqual({ quantity, unit: 'cups', name });
    });
});
