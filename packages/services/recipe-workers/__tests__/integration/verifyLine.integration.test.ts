import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { SQSEvent } from 'aws-lambda';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

/**
 * The verification gate driven the way SQS drives it — a queue BODY through the real `handler` (parse → schema →
 * policy → claim → reserve → Bedrock adapter → settle → verdict store → band feedback → memo), over MOCKED
 * dependencies (integration mocks them, §7.1a; the real-database proof is
 * `tests/e2e/verification/pasteOrigin.e2e.test.ts`).
 *
 * The real composition root wires the real `createVerdictStore`, `createSpendLedger`, `createBandFeedback` and
 * Bedrock converse client; only the four things that leave the process are replaced — the recipe database (drizzle
 * `execute` and the band tables' `pg` pool), the SSM read, and the Bedrock transport's `send`.
 *
 * ⛔ WHAT THIS PINS (ADR-0071). A line of a paste job the cook has not saved arrives with
 * `origin: { kind: 'parseJob', … }`. Its verdict must land in the SAME table under the SAME content key a saved
 * line would, it must always be asked about identity, its spend must be attributed to `paste-match-review`, and it
 * must touch NEITHER the shared band tables NOR the shared memo table — each of which the recipe origin, run
 * through the identical wiring as the control, does.
 */
const dialect = new PgDialect();

const { statements, poolQueries, converseRequests, answer } = vi.hoisted(() => ({
    statements: [] as { text: string; params: unknown[] }[],
    poolQueries: [] as string[],
    converseRequests: [] as unknown[],
    answer: { text: '{"verdict":"agree","certainty":"high","reason":"matches"}' },
}));

vi.mock('../../src/common/db.js', () => ({
    getRecipeDb: () => ({
        execute: (statement: SQL) => {
            const query = dialect.sqlToQuery(statement);
            const text = query.sql.replace(/\s+/gu, ' ').toLowerCase();

            statements.push({ text, params: query.params });

            if (text.includes('insert into recipe_verification_attempts')) {
                return Promise.resolve({ rows: [{ attempts: 1 }] });
            }

            if (text.includes('insert into verification_spend')) {
                return Promise.resolve({ rows: [{ reserved_micros: '116' }] });
            }

            if (text.includes('update verification_spend')) {
                return Promise.resolve({ rows: [{ period: '2026-10' }] });
            }

            return Promise.resolve({ rows: [] });
        },
    }),
    getRecipePool: () => ({
        query: (text: string) => {
            poolQueries.push(text.replace(/\s+/gu, ' ').toLowerCase());

            // A lexical resolution EXISTS for the food — so a band read or observation, were one made, would find a
            // band to land in. That is what makes "the pool was never queried" a claim about the code, not the data.
            return Promise.resolve({
                rows: [{ rung: 'head', margin: '0.40', query_shape: 'single', ranker_version: 'r1' }],
            });
        },
    }),
}));

vi.mock('../../src/verification/settings.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/verification/settings.js')>()),
    createSsmSettingsLoader: () => () =>
        Promise.resolve({ ceilingMicros: 100_000_000, modelId: 'amazon.nova-micro-v1:0' }),
}));

vi.mock('@kitchensink/bedrock-client', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@kitchensink/bedrock-client')>()),
    createBedrockTransport: () => ({
        client: {},
        send: (input: unknown) => {
            converseRequests.push(input);

            return Promise.resolve({
                output: { message: { role: 'assistant', content: [{ text: answer.text }] } },
                stopReason: 'end_turn',
                usage: { inputTokens: 660, outputTokens: 42, totalTokens: 702 },
            });
        },
    }),
}));

import { handler } from '../../src/handlers/verifyLine.js';

type TestHandler = (event: SQSEvent) => Promise<void>;
const runHandler = handler as unknown as TestHandler;

const RECIPE_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const FOOD_ID = '01JFOOD000000000000000000';

/** The line's content — everything the verdict key is computed from, and nothing about where it came from. */
const CONTENT = {
    sourceLine: '2 cups all-purpose flour',
    ingredientPhrase: 'all-purpose flour',
    foodId: FOOD_ID,
    candidateFoodName: 'Flour, wheat, all-purpose',
    quantityLow: 2,
    quantityHigh: null,
    unit: 'cup',
    evidenceKind: 'curated-exact',
    shortlist: [],
    requestedAt: '2026-10-25T10:00:00.000Z',
};

const PASTE_ORIGIN = {
    origin: { kind: 'parseJob', jobId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', lineIndex: 3, foodIndex: 1 },
};

/** One SQS event carrying one body. */
const event = (body: unknown): SQSEvent =>
    ({ Records: [{ messageId: 'm-1', body: JSON.stringify(body) }] }) as unknown as SQSEvent;

/** The statements whose text contains `fragment`. */
const issued = (fragment: string): { text: string; params: unknown[] }[] =>
    statements.filter((statement) => statement.text.includes(fragment));

/** The verdict INSERT, which carries the key first and the band fourth. */
const verdictInsert = (): { text: string; params: unknown[] } | undefined =>
    issued('insert into recipe_ingredient_verifications')[0];

let stdout: MockInstance<typeof console.log>;

/** The `CallSite` of every spend EMF line written this run. */
const spendCallSites = (): unknown[] =>
    stdout.mock.calls
        .map((call): Record<string, unknown> | undefined => {
            try {
                return JSON.parse(String(call[0])) as Record<string, unknown>;
            } catch {
                return undefined;
            }
        })
        .filter((line): line is Record<string, unknown> => line !== undefined && 'VerificationSpendMicros' in line)
        .map((line) => line['CallSite']);

beforeAll(() => {
    // `prod`, so the GATED path runs: the real ledger's reserve and settle SQL are part of what is exercised.
    process.env['STAGE'] = 'prod';
    process.env['AWS_REGION'] = 'us-east-1';
    process.env['VERIFICATION_CLAIM_LEASE_SECONDS'] = '60';
    process.env['VERIFICATION_ATTEMPT_ALLOWANCE'] = '20';
});

beforeEach(() => {
    statements.length = 0;
    poolQueries.length = 0;
    converseRequests.length = 0;
    answer.text = '{"verdict":"agree","certainty":"high","reason":"matches"}';
    stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
    stdout.mockRestore();
});

describe('the verification gate — a paste-job origin, queue body to verdict row (ADR-0071)', () => {
    it.each([
        ['verified', '{"verdict":"agree","certainty":"high","reason":"matches"}'],
        ['contradicted', '{"verdict":"disagree","certainty":"high","reason":"a different food"}'],
        ['inconclusive', '{"verdict":"abstain","certainty":"high","reason":"cannot tell"}'],
    ])('lands a %s verdict and touches neither the band tables nor the memo table', async (band, text) => {
        answer.text = text;

        await runHandler(event({ ...CONTENT, ...PASTE_ORIGIN }));

        expect(converseRequests).toHaveLength(1);
        expect(verdictInsert()?.params[3]).toBe(band);
        expect(issued('insert into ingredient_resolution_memos')).toHaveLength(0);
        expect(poolQueries).toEqual([]);
    });

    it('⛔ asks IDENTITY on curated evidence — the aspect a saved line is excused', async () => {
        await runHandler(event({ ...CONTENT, ...PASTE_ORIGIN }));
        const pasteAspects = JSON.stringify(verdictInsert()?.params);

        statements.length = 0;
        await runHandler(event({ ...CONTENT, recipeId: RECIPE_ID }));
        const recipeAspects = JSON.stringify(verdictInsert()?.params);

        expect(pasteAspects).toContain('identity');
        expect(recipeAspects).not.toContain('identity');
    });

    it("attributes the reserved spend to 'paste-match-review', through the real ledger", async () => {
        await runHandler(event({ ...CONTENT, ...PASTE_ORIGIN }));

        expect(issued('insert into verification_spend')).toHaveLength(1);
        expect(issued('update verification_spend')).toHaveLength(1);
        expect(spendCallSites()).toEqual(['paste-match-review']);
    });

    it('⛔ writes its verdict under the SAME key a saved line with the same content is keyed under', async () => {
        await runHandler(event({ ...CONTENT, ...PASTE_ORIGIN }));
        const pasteKey = verdictInsert()?.params[0];

        statements.length = 0;
        await runHandler(event({ ...CONTENT, recipeId: RECIPE_ID }));

        expect(typeof pasteKey).toBe('string');
        expect(verdictInsert()?.params[0]).toBe(pasteKey);
    });

    it('completes a paste origin the schema refuses without calling the model — poison is recorded, not retried', async () => {
        await runHandler(event({ ...CONTENT, origin: { ...PASTE_ORIGIN.origin, lineIndex: -1 } }));

        expect(converseRequests).toHaveLength(0);
        expect(verdictInsert()).toBeUndefined();
    });
});

/**
 * The controls: the same wiring, a SAVED recipe's line. The legacy `recipeId` spelling and the `origin` spelling
 * must produce the same statements, and both must reach the band tables and the memo — which is what makes the
 * paste origin's silence above a property of the origin rather than of the fixtures.
 */
describe('the verification gate — a recipe origin, both spellings', () => {
    it.each([
        ['legacy recipeId', { recipeId: RECIPE_ID }],
        ['origin', { origin: { kind: 'recipe', recipeId: RECIPE_ID } }],
    ])('the %s spelling reports to the band tables, remembers the phrase, and claims as the gate', async (_l, o) => {
        // Ranked evidence, so the band read and the observation both have a lexical bind to be about.
        await runHandler(
            event({ ...CONTENT, evidenceKind: 'ranked', shortlist: [{ foodId: FOOD_ID, score: 0.9 }], ...o }),
        );

        expect(verdictInsert()?.params[3]).toBe('verified');
        expect(issued('insert into ingredient_resolution_memos')).toHaveLength(1);
        expect(poolQueries.some((text) => text.includes('from ingredient_resolutions'))).toBe(true);
        expect(spendCallSites()).toEqual(['verification-gate']);
    });

    it('issues byte-identical statements for the two spellings', async () => {
        await runHandler(event({ ...CONTENT, recipeId: RECIPE_ID }));
        const legacy = [...statements];

        statements.length = 0;
        await runHandler(event({ ...CONTENT, origin: { kind: 'recipe', recipeId: RECIPE_ID } }));

        expect(statements).toEqual(legacy);
    });
});
