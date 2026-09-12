/**
 * Copy-forward dedup before queuing — the SCHEMA half, against a real PostgreSQL (migration 0048).
 *
 * Written RED-first from `docs/plans/2026-09-19-001-feat-parse-job-enqueue-dedup-plan.md` §5.
 *
 * ⛔ SCOPE: this file asserts the migration's own artifact — the partial index the copy-forward lookup
 * reads — and nothing else. The behaviour that index supports (the message is never sent, the copy commits
 * inside `createJob`'s transaction, the job aggregate is recomputed so an all-copied job cannot sit
 * `running` forever) is proved one tier up, through the real app and a real queue, in
 * `../parseJobs/parseJobCopyForward.integration.test.ts`. Keep the two separate: a schema claim is about
 * the database alone and must stay observable when the service code changes shape.
 *
 * A unit test cannot stand in for this one — it cannot observe a migration that did not apply.
 *
 * Connects as `recipe_app` (DML only — the production role), per ADR-0039 and `tests/support/roleDb.ts`.
 */
import { afterEach, afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { hasTestDatabase, recipeDb } from '../../../tests/support/roleDb.js';

const roleDb = recipeDb();

describe.skipIf(!hasTestDatabase)('parse-job copy-forward substrate (migration 0048)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterEach(async () => {
        // Jobs cascade to their lines; the owner prefix scopes the sweep to this file's fixtures.
        await pool.query(`DELETE FROM recipe_parse_jobs WHERE owner_id LIKE 'copyfwd-%'`);
    });

    afterAll(async () => {
        await pool.end();
    });

    /**
     * ⛔ The index is the whole reason the lookup is affordable. Without it every `create` seq-scans a table
     * that grows with every pasted line anyone has ever submitted — so the dedup would trade one SQS message
     * for a full-table scan, which is a worse deal than the defect.
     *
     * Asserted by NAME and by the column it covers, not merely "some index exists": a future migration that
     * renamed or re-columned it would otherwise pass.
     */
    it('indexes recipe_parse_job_lines on line_digest for the copy-forward lookup', async () => {
        const { rows } = await pool.query<{ indexdef: string }>(
            `SELECT indexdef FROM pg_indexes
              WHERE tablename = 'recipe_parse_job_lines'
                AND indexname = 'recipe_parse_job_lines_copy_forward_idx'`,
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]?.indexdef).toContain('line_digest');
        // Partial: only a line carrying an answer can ever be copied, so the index carries only those rows.
        expect(rows[0]?.indexdef).toContain('proposal IS NOT NULL');
    });

    /**
     * ⛔ THE LEASE TABLE HOLDS NO OWNER LINK — and this assertion IS the argument, not the prose that claims
     * it. `ingredient_parse_leases` is absent from the account-erasure sweep, inheriting
     * `ingredient_parse_cache`'s reasoning: a one-way digest and a timestamp carry no person-to-row link.
     *
     * ⚠️ `erasureSweepCoverage.test.ts` CANNOT witness that claim, which is why this exists. It discovers
     * tables by owner-column SHAPE, so a table with no identifier column is never discovered and its 36
     * green tests are SILENT about this one — passing there is the absence of a question, not an answer.
     * Nor can it be registered as retained-by-ruling: that map asserts every key is owner-bearing.
     *
     * ⚠️ SET EQUALITY, not a denylist, for the reason the cache's own guard gives: a denylist catches only
     * the names someone thought of, while this reds on ANY new column — at which point whoever adds one
     * owes an erasure decision.
     */
    it('⛔ the parse lease holds no owner link and no user-identifying column', async () => {
        const { rows } = await pool.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns
              WHERE table_name = 'ingredient_parse_leases' ORDER BY column_name`,
        );

        expect(rows.map((row) => row.column_name)).toEqual(['leased_until', 'line_digest']);
    });
});
