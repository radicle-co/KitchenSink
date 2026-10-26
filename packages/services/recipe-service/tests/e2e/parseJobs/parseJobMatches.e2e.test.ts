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
 *  4. **The DAL's rules.** A save lands only while the line still has the digest it was computed under (a slow call
 *     cannot overwrite a newer row); it never overwrites a row for the same judgement (two concurrent POSTs agree), and
 *     a row for another judgement is replaced with its enqueue reset (an edited or reparsed line is matched afresh).
 *  5. **A claim is a LEASE.** Only one caller wins `enqueued_at`, only for the digest and key it asked about; only that
 *     caller's own claim is released; and a claim older than the queue's delivery bound that left no verdict and no
 *     attempt behind may be taken again (the request was lost).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { parseStoredLineDigest, type LineDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import { verificationDeliveryBoundSeconds } from '@kitchensink/recipe-core/resolution/verification-delivery';

import { createRecipeDrizzle } from '../../../src/database/client.js';
import { ParseJobMatchesDal } from '../../../src/recipes/dal/parseJobMatches.dal.js';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();
const OWNER = '01JMATCHESE2EOWNER0000000A';
const OTHER = '01JMATCHESE2EOTHER0000000A';
const MILK = parseStoredLineDigest('digest-milk');
const SALT = parseStoredLineDigest('digest-salt');
const EDITED = parseStoredLineDigest('digest-edited');
/** The queue's delivery bound, the age past which a traceless claim was lost. */
const STALE_AFTER = verificationDeliveryBoundSeconds();

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
            ['curation_reported_at', 'timestamp with time zone', 'YES'],
            ['enqueued_at', 'timestamp with time zone', 'YES'],
            ['food_id', 'text', 'YES'],
            ['food_index', 'integer', 'NO'],
            ['food_variant_id', 'text', 'YES'],
            ['job_id', 'uuid', 'NO'],
            ['judgement_digest', 'text', 'NO'],
            ['line_digest', 'text', 'NO'],
            ['line_index', 'integer', 'NO'],
            ['margin', 'double precision', 'YES'],
            ['matched_by', 'text', 'YES'],
            ['review', 'text', 'YES'],
            ['rung', 'text', 'YES'],
            ['verification_key', 'text', 'YES'],
        ]);
    });

    it.each([
        ['both food arms', `'curated', 'F1', 'V1', NULL, NULL, NULL`],
        ['a food with no tier that proposed it', `NULL, 'F1', NULL, NULL, NULL, NULL`],
        ['a tier with no food', `'lexical', NULL, NULL, NULL, NULL, NULL`],
        ['a key with no food', `NULL, NULL, NULL, 'v2:k', 'owed', NULL`],
        ['an enqueue with no key', `'curated', 'F1', NULL, NULL, NULL, now()`],
        ['an unknown tier', `'llm', 'F1', NULL, NULL, NULL, NULL`],
        ['a key with no review owed', `'curated', 'F1', NULL, 'v2:k', NULL, NULL`],
        ['a review owed with no key', `'curated', 'F1', NULL, NULL, 'owed', NULL`],
        ['a refusal carrying a key', `'curated', 'F1', NULL, 'v2:k', 'refused', NULL`],
        ['a refusal of nothing proposed', `NULL, NULL, NULL, NULL, 'refused', NULL`],
        ['an unknown review', `'curated', 'F1', NULL, NULL, 'parked', NULL`],
    ])('⛔ refuses a row with %s', async (_label, values) => {
        const job = await insertJob(pool, OWNER);

        await expect(
            pool.query(
                `INSERT INTO recipe_parse_job_matches
                     (job_id, line_index, food_index, line_digest, judgement_digest, matched_by, food_id,
                      food_variant_id, verification_key, review, enqueued_at)
                 VALUES ($1, 0, 0, 'digest-milk', 'j1:a', ${values})`,
                [job],
            ),
        ).rejects.toThrow(/violates check constraint/u);
    });

    it('⛔ refuses more than five candidates', async () => {
        const job = await insertJob(pool, OWNER);
        const six = JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ kind: 'root', id: `F${String(i)}` })));

        await expect(
            pool.query(
                `INSERT INTO recipe_parse_job_matches
                     (job_id, line_index, food_index, line_digest, judgement_digest, candidates)
                 VALUES ($1, 0, 0, 'digest-milk', 'j1:a', $2::jsonb)`,
                [job, six],
            ),
        ).rejects.toThrow(/violates check constraint/u);
    });

    it('⛔ refuses a match for a line the job does not have — the FK is to the LINE', async () => {
        const job = await insertJob(pool, OWNER);

        await expect(
            pool.query(
                `INSERT INTO recipe_parse_job_matches (job_id, line_index, food_index, line_digest, judgement_digest)
                 VALUES ($1, 7, 0, 'digest-none', 'j1:a')`,
                [job],
            ),
        ).rejects.toThrow(/violates foreign key constraint/u);
    });

    it('removes a job’s matches when the job is deleted (ON DELETE CASCADE through its lines)', async () => {
        const job = await insertJob(pool, OWNER);

        await dal.saveMatches(job, [noMatch(0, 0, MILK)]);
        await pool.query('DELETE FROM recipe_parse_jobs WHERE id = $1', [job]);

        expect(await countFor(job)).toBe(0);
    });

    it('⛔ account erasure reaches the matches: the sweep’s own statement leaves none for the cook', async () => {
        const mine = await insertJob(pool, OWNER);
        const theirs = await insertJob(pool, OTHER);

        await dal.saveMatches(mine, [noMatch(0, 0, MILK)]);
        await dal.saveMatches(theirs, [noMatch(0, 0, MILK)]);
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
                lineDigest: MILK,
                judgementDigest: 'j1:milk',
                proposal: { matchedBy: 'lexical', food: { kind: 'root', id: 'F-whole' }, rung: 'head', margin: 0.25 },
                candidates: [
                    { kind: 'root', id: 'F-whole', rung: 'head' },
                    { kind: 'variant', id: 'V-skim', rung: null },
                ],
                verificationKey: 'v2:milk',
                review: 'owed',
            },
        ]);

        expect(await dal.findForJob(OTHER, job)).toEqual([]);
        expect(await dal.findForJob(OWNER, job)).toEqual([
            {
                lineIndex: 0,
                foodIndex: 0,
                lineDigest: MILK,
                judgementDigest: 'j1:milk',
                proposal: { matchedBy: 'lexical', food: { kind: 'root', id: 'F-whole' }, rung: 'head', margin: 0.25 },
                candidates: [
                    { kind: 'root', id: 'F-whole', rung: 'head' },
                    { kind: 'variant', id: 'V-skim', rung: null },
                ],
                verificationKey: 'v2:milk',
                review: 'owed',
                enqueuedAt: null,
                // The line's STORED digest now, read with the row (the job view compares it, ADR-0071).
                lineDigestNow: MILK,
            },
        ]);
    });

    it('⛔ never overwrites a row for the SAME judgement, and replaces one for ANOTHER with its enqueue reset', async () => {
        const job = await insertJob(pool, OWNER);

        await dal.saveMatches(job, [proposed(0, 0, MILK, 'F-first', 'j1:first')]);
        await dal.claimEnqueue(job, [request(0, 0, MILK, 'F-first')], STALE_AFTER);
        // A concurrent POST computed a different answer for the same judgement: the first row stands.
        await dal.saveMatches(job, [proposed(0, 0, MILK, 'F-second', 'j1:first')]);

        const same = await dal.findForJob(OWNER, job);

        expect(same[0]?.proposal?.food.id).toBe('F-first');
        expect(same[0]?.enqueuedAt).not.toBeNull();

        // The same text was reparsed into another judgement: the row is matched afresh, its enqueue owed again.
        await dal.saveMatches(job, [proposed(0, 0, MILK, 'F-reparsed', 'j1:reparsed')]);

        const replaced = await dal.findForJob(OWNER, job);

        expect(replaced[0]).toMatchObject({
            judgementDigest: 'j1:reparsed',
            verificationKey: 'v2:F-reparsed',
            enqueuedAt: null,
        });
    });

    it('⛔ a SLOW call computed for an older line digest cannot overwrite the newer row, nor insert one', async () => {
        const job = await insertJob(pool, OWNER);

        await dal.saveMatches(job, [proposed(0, 0, MILK, 'F-old', 'j1:old')]);
        // The cook edits the line, and a fresh call matches the new text.
        await pool.query(`UPDATE recipe_parse_job_lines SET line_digest = 'digest-edited' WHERE job_id = $1 AND line_index = 0`, [job]);
        await dal.saveMatches(job, [proposed(0, 0, EDITED, 'F-new', 'j1:new')]);
        // The slow call, computed for the OLD text, lands last.
        await dal.saveMatches(job, [proposed(0, 0, MILK, 'F-stale', 'j1:stale'), proposed(0, 1, MILK, 'F-stale', 'j1:s1')]);

        const rows = await dal.findForJob(OWNER, job);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ lineDigest: EDITED, judgementDigest: 'j1:new', lineDigestNow: EDITED });
        expect(rows[0]?.proposal?.food.id).toBe('F-new');
    });

    it('⛔ an enqueue is CLAIMED once, only for the digest and key asked about, and its owner releases it', async () => {
        const job = await insertJob(pool, OWNER);

        await dal.saveMatches(job, [
            proposed(0, 0, MILK, 'F-milk', 'j1:milk'),
            proposed(1, 0, SALT, 'F-salt', 'j1:salt'),
            noMatch(1, 1, SALT),
        ]);

        const won = await dal.claimEnqueue(job, [request(0, 0, MILK, 'F-milk'), request(1, 0, SALT, 'F-salt')], STALE_AFTER);

        expect(won.map(({ lineIndex, foodIndex }) => [lineIndex, foodIndex])).toEqual([
            [0, 0],
            [1, 0],
        ]);
        expect(won.every((claim) => claim.claimedAt instanceof Date)).toBe(true);
        expect(await dal.claimEnqueue(job, [request(0, 0, MILK, 'F-milk')], STALE_AFTER)).toEqual([]);

        const [mine] = won;

        if (mine === undefined) {
            throw new Error('no claim was won');
        }

        await dal.releaseEnqueue(job, [mine]);

        expect(await dal.claimEnqueue(job, [request(0, 0, MILK, 'F-milk')], STALE_AFTER)).toHaveLength(1);
    });

    it('⛔ claims nothing for a stale digest or a stale key — the row moved on since the request was built', async () => {
        const job = await insertJob(pool, OWNER);

        await dal.saveMatches(job, [proposed(0, 0, MILK, 'F-milk', 'j1:milk')]);

        expect(await dal.claimEnqueue(job, [request(0, 0, EDITED, 'F-milk')], STALE_AFTER)).toEqual([]);
        expect(await dal.claimEnqueue(job, [request(0, 0, MILK, 'F-other')], STALE_AFTER)).toEqual([]);
    });

    it('⛔ a release cannot clear ANOTHER caller’s claim — only the claim it holds', async () => {
        const job = await insertJob(pool, OWNER);

        await dal.saveMatches(job, [proposed(0, 0, MILK, 'F-milk', 'j1:milk')]);

        const [claim] = await dal.claimEnqueue(job, [request(0, 0, MILK, 'F-milk')], STALE_AFTER);

        if (claim === undefined) {
            throw new Error('no claim was won');
        }

        // A caller whose claim went stale releases what it THINKS it holds; the row now holds a later claim.
        await dal.releaseEnqueue(job, [{ ...claim, claimedAt: new Date(claim.claimedAt.getTime() - 60_000) }]);

        expect((await dal.findForJob(OWNER, job))[0]?.enqueuedAt).toEqual(claim.claimedAt);
    });

    it('⛔ a curated contradiction is REPORTED once per row and verdict key, and again for a replaced row', async () => {
        const job = await insertJob(pool, OWNER);
        const curated = { ...proposed(0, 0, MILK, 'F-milk', 'j1:milk'), proposal: { ...proposed(0, 0, MILK, 'F-milk', 'j1:milk').proposal, matchedBy: 'curated' } } as const;

        await dal.saveMatches(job, [curated]);

        const slot = { lineIndex: 0, foodIndex: 0, verificationKey: 'v2:F-milk' };

        expect(await dal.claimCurationReport(job, slot)).toBe(true);
        expect(await dal.claimCurationReport(job, slot)).toBe(false);
        expect(await dal.claimCurationReport(job, { ...slot, verificationKey: 'v2:other' })).toBe(false);

        // The same text reparsed into another judgement: the new row has not been reported.
        await dal.saveMatches(job, [{ ...curated, judgementDigest: 'j1:reparsed' }]);

        expect(await dal.claimCurationReport(job, slot)).toBe(true);
    });

    describe('⛔ a claim older than the delivery bound (the request was lost)', () => {
        /** A job whose one owed review was claimed longer ago than the queue could still deliver it. */
        async function lostClaim(): Promise<string> {
            const job = await insertJob(pool, OWNER);

            await dal.saveMatches(job, [proposed(0, 0, MILK, 'F-milk', 'j1:milk')]);
            await pool.query(
                `UPDATE recipe_parse_job_matches SET enqueued_at = now() - make_interval(secs => $2 + 60)
                  WHERE job_id = $1`,
                [job, STALE_AFTER],
            );

            return job;
        }

        afterEach(async () => {
            await pool.query(`DELETE FROM recipe_ingredient_verifications WHERE verification_key = 'v2:F-milk'`);
            await pool.query(`DELETE FROM recipe_verification_attempts WHERE verification_key = 'v2:F-milk'`);
        });

        it('is claimed again when it left no verdict and no attempt', async () => {
            const job = await lostClaim();

            expect(await dal.claimEnqueue(job, [request(0, 0, MILK, 'F-milk')], STALE_AFTER)).toHaveLength(1);
        });

        it('is NOT claimed again while an attempt is on record — the worker still holds it', async () => {
            const job = await lostClaim();

            await pool.query(
                `INSERT INTO recipe_verification_attempts (verification_key, model_id, attempts) VALUES ('v2:F-milk', 'm', 1)`,
            );

            expect(await dal.claimEnqueue(job, [request(0, 0, MILK, 'F-milk')], STALE_AFTER)).toEqual([]);
        });

        it('is NOT claimed again once a verdict is on record', async () => {
            const job = await lostClaim();

            await pool.query(
                `INSERT INTO recipe_ingredient_verifications
                     (verification_key, verdict, certainty, band, aspects, model_id, food_id)
                 VALUES ('v2:F-milk', 'agree', 'high', 'verified', ARRAY['identity','quantity'], 'm', 'F-milk')`,
            );

            expect(await dal.claimEnqueue(job, [request(0, 0, MILK, 'F-milk')], STALE_AFTER)).toEqual([]);
        });

        it('is NOT claimed again inside the bound', async () => {
            const job = await insertJob(pool, OWNER);

            await dal.saveMatches(job, [proposed(0, 0, MILK, 'F-milk', 'j1:milk')]);
            await dal.claimEnqueue(job, [request(0, 0, MILK, 'F-milk')], STALE_AFTER);

            expect(await dal.claimEnqueue(job, [request(0, 0, MILK, 'F-milk')], STALE_AFTER)).toEqual([]);
        });
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
function noMatch(lineIndex: number, foodIndex: number, lineDigest: LineDigest) {
    return {
        lineIndex,
        foodIndex,
        lineDigest,
        judgementDigest: `j1:none-${String(lineIndex)}-${String(foodIndex)}`,
        proposal: null,
        candidates: [],
        verificationKey: null,
        review: null,
    } as const;
}

/** A row proposing one root food from the lexical tier, its review owed under `v2:{foodId}`. */
function proposed(lineIndex: number, foodIndex: number, lineDigest: LineDigest, foodId: string, judgementDigest: string) {
    return {
        lineIndex,
        foodIndex,
        lineDigest,
        judgementDigest,
        proposal: { matchedBy: 'lexical', food: { kind: 'root', id: foodId }, rung: 'head', margin: null },
        candidates: [{ kind: 'root', id: foodId, rung: 'head' }],
        verificationKey: `v2:${foodId}`,
        review: 'owed',
    } as const;
}

/** A claim request for the row {@link proposed} wrote. */
function request(lineIndex: number, foodIndex: number, lineDigest: LineDigest, foodId: string) {
    return { lineIndex, foodIndex, lineDigest, verificationKey: `v2:${foodId}` };
}
