/**
 * Migration 0057 and `ParseJobMatchesDal` against a REAL PostgreSQL (ADR-0071) — the LOCAL e2e tier, because a unit
 * test cannot observe a migration that did not apply, a CHECK that does not hold, or a cascade that does not fire.
 *
 * What is pinned, and why each one matters:
 *
 *  1. **The table's shape and its CHECKs.** A match row is a proposal, never a binding, and it stores no food NAME
 *     (ADR-0045): names are resolved at read time, as the caller. A row names at most one food, a proposed food needs
 *     the tier that proposed it, an enqueue needs a verification key, and at most five candidates are kept.
 *  2. **The composite FK to the LINE.** A match for a line the job does not have is refused, and deleting a job
 *     (the TTL purge, a stranger cannot) removes its matches through the lines.
 *  3. **Account erasure reaches it.** The sweep deletes a cook's jobs with one statement
 *     (`DELETE FROM recipe_parse_jobs WHERE owner_id = $1`, `recipe-workers`' `accountErasureWorker.ts`). This suite
 *     runs that exact statement, because the worker package exports only its infra and this one may not edit it.
 *  4. **The DAL's three rules.** A save never overwrites a row for the same digest (two concurrent POSTs agree), a row
 *     for a different digest is replaced and its enqueue reset (an edited line is matched afresh), and an enqueue is
 *     CLAIMED: only one caller wins `enqueued_at`, and a release hands it back.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { createRecipeDrizzle } from '../../../src/database/client.js';
import { ParseJobMatchesDal } from '../../../src/recipes/dal/parseJobMatches.dal.js';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();
const OWNER = '01JMATCHESE2EOWNER0000000A';
const OTHER = '01JMATCHESE2EOTHER0000000A';

/** A job with two lines, inserted directly: this suite is about the match table, not the create path. */
async function insertJob(pool: pg.Pool, ownerId: string): Promise<string> {
    const job = await pool.query<{ id: string }>(
        `INSERT INTO recipe_parse_jobs (owner_id, expires_at) VALUES ($1, now() + interval '1 day') RETURNING id`,
        [ownerId],
    );
    const id = job.rows[0]?.id ?? '';

    await pool.query(
        `INSERT INTO recipe_parse_job_lines (job_id, line_index, source_line, line_digest, status)
         VALUES ($1, 0, '1 cup milk', 'digest-milk', 'parsed'), ($1, 1, 'salt and pepper', 'digest-salt', 'parsed')`,
        [id],
    );

    return id;
}

describe('recipe_parse_job_matches (migration 0057) and ParseJobMatchesDal', () => {
    let pool: pg.Pool;
    let dal: ParseJobMatchesDal;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        dal = new ParseJobMatchesDal(createRecipeDrizzle(pool));
    });

    afterEach(async () => {
        await pool.query('DELETE FROM recipe_parse_jobs WHERE owner_id IN ($1, $2)', [OWNER, OTHER]);
    });

    afterAll(async () => {
        await pool.end();
    });

    it('has the columns the DAL reads, with no food NAME column (ADR-0045)', async () => {
        const columns = await pool.query<{ column_name: string; is_nullable: string; data_type: string }>(
            `SELECT column_name, is_nullable, data_type FROM information_schema.columns
              WHERE table_name = 'recipe_parse_job_matches' ORDER BY column_name`,
        );

        expect(columns.rows.map((row) => [row.column_name, row.data_type, row.is_nullable])).toEqual([
            ['candidates', 'jsonb', 'NO'],
            ['created_at', 'timestamp with time zone', 'NO'],
            ['enqueued_at', 'timestamp with time zone', 'YES'],
            ['food_id', 'text', 'YES'],
            ['food_index', 'integer', 'NO'],
            ['food_variant_id', 'text', 'YES'],
            ['job_id', 'uuid', 'NO'],
            ['line_digest', 'text', 'NO'],
            ['line_index', 'integer', 'NO'],
            ['margin', 'double precision', 'YES'],
            ['matched_by', 'text', 'YES'],
            ['rung', 'text', 'YES'],
            ['verification_key', 'text', 'YES'],
        ]);
    });

    it.each([
        ['both food arms', `'curated', 'F1', 'V1', NULL, NULL`],
        ['a food with no tier that proposed it', `NULL, 'F1', NULL, NULL, NULL`],
        ['a tier with no food', `'lexical', NULL, NULL, NULL, NULL`],
        ['a key with no food', `NULL, NULL, NULL, 'v2:k', NULL`],
        ['an enqueue with no key', `'curated', 'F1', NULL, NULL, now()`],
        ['an unknown tier', `'llm', 'F1', NULL, NULL, NULL`],
    ])('⛔ refuses a row with %s', async (_label, values) => {
        const job = await insertJob(pool, OWNER);

        await expect(
            pool.query(
                `INSERT INTO recipe_parse_job_matches
                     (job_id, line_index, food_index, line_digest, matched_by, food_id, food_variant_id,
                      verification_key, enqueued_at)
                 VALUES ($1, 0, 0, 'digest-milk', ${values})`,
                [job],
            ),
        ).rejects.toThrow(/violates check constraint/u);
    });

    it('⛔ refuses more than five candidates', async () => {
        const job = await insertJob(pool, OWNER);
        const six = JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ kind: 'root', id: `F${String(i)}` })));

        await expect(
            pool.query(
                `INSERT INTO recipe_parse_job_matches (job_id, line_index, food_index, line_digest, candidates)
                 VALUES ($1, 0, 0, 'digest-milk', $2::jsonb)`,
                [job, six],
            ),
        ).rejects.toThrow(/violates check constraint/u);
    });

    it('⛔ refuses a match for a line the job does not have — the FK is to the LINE', async () => {
        const job = await insertJob(pool, OWNER);

        await expect(
            pool.query(
                `INSERT INTO recipe_parse_job_matches (job_id, line_index, food_index, line_digest)
                 VALUES ($1, 7, 0, 'digest-none')`,
                [job],
            ),
        ).rejects.toThrow(/violates foreign key constraint/u);
    });

    it('removes a job’s matches when the job is deleted (ON DELETE CASCADE through its lines)', async () => {
        const job = await insertJob(pool, OWNER);

        await dal.saveMatches(job, [noMatch(0, 0, 'digest-milk')]);
        await pool.query('DELETE FROM recipe_parse_jobs WHERE id = $1', [job]);

        expect(await countFor(job)).toBe(0);
    });

    it('⛔ account erasure reaches the matches: the sweep’s own statement leaves none for the cook', async () => {
        const mine = await insertJob(pool, OWNER);
        const theirs = await insertJob(pool, OTHER);

        await dal.saveMatches(mine, [noMatch(0, 0, 'digest-milk')]);
        await dal.saveMatches(theirs, [noMatch(0, 0, 'digest-milk')]);
        // The exact statement `eraseRecipeRows` issues for parse jobs (accountErasureWorker.ts).
        await pool.query('DELETE FROM recipe_parse_jobs WHERE owner_id = $1', [OWNER]);

        expect(await countFor(mine)).toBe(0);
        expect(await countFor(theirs)).toBe(1);
    });

    it('round-trips a proposal and its candidates, read back only for the job’s OWNER', async () => {
        const job = await insertJob(pool, OWNER);

        await dal.saveMatches(job, [
            {
                lineIndex: 0,
                foodIndex: 0,
                lineDigest: 'digest-milk',
                proposal: { matchedBy: 'lexical', food: { kind: 'root', id: 'F-whole' }, rung: 'head', margin: 0.25 },
                candidates: [
                    { kind: 'root', id: 'F-whole', rung: 'head' },
                    { kind: 'variant', id: 'V-skim', rung: null },
                ],
                verificationKey: 'v2:milk',
            },
        ]);

        expect(await dal.findForJob(OTHER, job)).toEqual([]);
        expect(await dal.findForJob(OWNER, job)).toEqual([
            {
                lineIndex: 0,
                foodIndex: 0,
                lineDigest: 'digest-milk',
                proposal: { matchedBy: 'lexical', food: { kind: 'root', id: 'F-whole' }, rung: 'head', margin: 0.25 },
                candidates: [
                    { kind: 'root', id: 'F-whole', rung: 'head' },
                    { kind: 'variant', id: 'V-skim', rung: null },
                ],
                verificationKey: 'v2:milk',
                enqueuedAt: null,
            },
        ]);
    });

    it('⛔ never overwrites a row for the SAME digest, and replaces one for a NEW digest with its enqueue reset', async () => {
        const job = await insertJob(pool, OWNER);
        const first = { ...proposed(0, 0, 'digest-milk', 'F-first'), verificationKey: 'v2:first' };

        await dal.saveMatches(job, [first]);
        await dal.claimEnqueue(job, [{ lineIndex: 0, foodIndex: 0 }]);
        // A concurrent POST computed a different answer for the same line text: the first row stands.
        await dal.saveMatches(job, [{ ...proposed(0, 0, 'digest-milk', 'F-second'), verificationKey: 'v2:second' }]);

        const same = await dal.findForJob(OWNER, job);

        expect(same[0]?.proposal?.food.id).toBe('F-first');
        expect(same[0]?.enqueuedAt).not.toBeNull();

        // The line was edited: the digest moved, so the row is matched afresh and its enqueue is owed again.
        await dal.saveMatches(job, [{ ...proposed(0, 0, 'digest-edited', 'F-edited'), verificationKey: 'v2:edited' }]);

        const replaced = await dal.findForJob(OWNER, job);

        expect(replaced[0]).toMatchObject({
            lineDigest: 'digest-edited',
            verificationKey: 'v2:edited',
            enqueuedAt: null,
        });
        expect(replaced[0]?.proposal?.food.id).toBe('F-edited');
    });

    it('⛔ an enqueue is CLAIMED once: a second claim wins nothing, and a release hands it back', async () => {
        const job = await insertJob(pool, OWNER);

        await dal.saveMatches(job, [
            { ...proposed(0, 0, 'digest-milk', 'F-milk'), verificationKey: 'v2:milk' },
            { ...proposed(1, 0, 'digest-salt', 'F-salt'), verificationKey: 'v2:salt' },
            noMatch(1, 1, 'digest-salt'),
        ]);

        const won = await dal.claimEnqueue(job, [
            { lineIndex: 0, foodIndex: 0 },
            { lineIndex: 1, foodIndex: 0 },
            { lineIndex: 1, foodIndex: 1 },
        ]);

        // The no-match row has no key, so it can never be claimed.
        expect(won).toEqual([
            { lineIndex: 0, foodIndex: 0 },
            { lineIndex: 1, foodIndex: 0 },
        ]);
        expect(await dal.claimEnqueue(job, [{ lineIndex: 0, foodIndex: 0 }])).toEqual([]);

        await dal.releaseEnqueue(job, [{ lineIndex: 0, foodIndex: 0 }]);

        expect(await dal.claimEnqueue(job, [{ lineIndex: 0, foodIndex: 0 }])).toEqual([{ lineIndex: 0, foodIndex: 0 }]);
    });

    /** How many match rows a job has. */
    async function countFor(job: string): Promise<number> {
        const result = await pool.query<{ n: string }>(
            'SELECT count(*) AS n FROM recipe_parse_job_matches WHERE job_id = $1',
            [job],
        );

        return Number(result.rows[0]?.n ?? 0);
    }
});

/** A row recording that the chain found nothing. */
function noMatch(lineIndex: number, foodIndex: number, lineDigest: string) {
    return { lineIndex, foodIndex, lineDigest, proposal: null, candidates: [], verificationKey: null } as const;
}

/** A row proposing one root food from the lexical tier. */
function proposed(lineIndex: number, foodIndex: number, lineDigest: string, foodId: string) {
    return {
        lineIndex,
        foodIndex,
        lineDigest,
        proposal: { matchedBy: 'lexical', food: { kind: 'root', id: foodId }, rung: 'head', margin: null },
        candidates: [{ kind: 'root', id: foodId, rung: 'head' }],
        verificationKey: null,
    } as const;
}
