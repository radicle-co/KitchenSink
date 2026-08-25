/**
 * U21 — RIGHT TO ERASURE OVER THE PARSE-CORRECTION TIER, against the real schema (plan U21, KTD-14).
 *
 * ## Why this tier, and why the unit suite next door cannot stand in for it
 *
 * `accountErasureWorker.test.ts` pins the SQL the sweep emits. Every claim below depends on something
 * only PostgreSQL enforces, so the rendered statement cannot make any of them:
 *
 *  1. **That the statement is legal at all.** `owner_id` and `source_line` must be NULLABLE. Migration
 *     0029 creates them so — and it is the SAME migration as the sweep, which is 0026's rule verbatim:
 *     *"the sweep sets it to NULL, and a sweep that runs against the old constraint fails the erasure
 *     job rather than the statement."* A fake db accepts the statement either way.
 *  2. ⛔ **That the two columns cannot come apart.** 0029 carries a CHECK making
 *     `(owner_id IS NULL) = (source_line IS NULL)`, so a half-sweep is not a bug to be found in review —
 *     it is a row PostgreSQL refuses to store. Only a real database can prove that, and this suite fires
 *     both halves at it directly.
 *  3. ⛔ **That the row SURVIVES.** The correction is consulted by every user's parse pipeline, ahead of
 *     the cache. A `DELETE` — or an `UPDATE` that also cleared `corrected_facts` — would silently
 *     un-correct that line installation-wide, which is a second user's data loss caused by the first
 *     user's erasure.
 *  4. **That the partial unique index releases the erased owner's slot**, so an erased-and-returning
 *     user is not barred from ever correcting that line again.
 *  5. **That another cook's live correction is untouched.** Scope is a `WHERE` clause, and a `WHERE`
 *     clause is only as good as the rows it runs against.
 *  6. **That the sweep is idempotent against a row already NULL on both columns** — an SQS redelivery
 *     re-runs it, and the CHECK is what makes the re-run's target state its current state.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import { eraseRecipeRows } from '../../../src/handlers/accountErasureWorker.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const canRun = Boolean(DATABASE_URL);

/** The cook being erased. */
const OWNER_ERASED = '01JU21PARSEERASE0OWNERA0000';

/** A bystander cook whose own correction MUST survive, identifiers intact. */
const OWNER_BYSTANDER = '01JU21PARSEERASE0OWNERB0000';

/** The line both cooks corrected — the key their agreement is counted on. */
const KEY = 'u21 erasure probe 2 cups plain flour, sifted';

/** The corrected parse both corrections assert. Structured facts; never the raw line. */
const FACTS = { statedMeasure: '2 cups', unit: 'cup', foods: [{ name: 'plain flour', prep: 'sifted' }] };

/** One `ingredient_parse_corrections` row, as this suite reads it back. */
type CorrectionRow = {
    readonly id: string;
    readonly owner_id: string | null;
    readonly source_line: string | null;
    readonly corrected_facts: unknown;
    readonly superseded_at: Date | null;
    readonly origin: string;
    readonly corroborated_a: string | null;
    readonly corroborated_b: string | null;
};

describe.skipIf(!canRun)('erasure over the parse-correction tier (U21 integration)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = drizzle(pool);
    });

    afterEach(async () => {
        await db.execute(sql`DELETE FROM ingredient_parse_corrections WHERE normalized_key = ${KEY}`);
        await db.execute(sql`DELETE FROM account_erasure_jobs WHERE owner_id IN (${OWNER_ERASED}, ${OWNER_BYSTANDER})`);
    });

    afterAll(async () => {
        await pool.end();
    });

    /**
     * Insert one live author-scoped correction and return its id.
     *
     * @param ownerId - The cook who typed it.
     * @param line - The raw line, as typed.
     * @returns The new row's id.
     * @sideEffect Inserts into `ingredient_parse_corrections`.
     */
    async function insertCorrection(ownerId: string, line: string): Promise<string> {
        const result = await db.execute<{ id: string }>(sql`
            INSERT INTO ingredient_parse_corrections
                (normalized_key, source_line, corrected_facts, scope, origin, owner_id, surfacing)
            VALUES (${KEY}, ${line}, ${JSON.stringify(FACTS)}::jsonb, 'author', 'author', ${ownerId}, 'recipe-line')
            RETURNING id
        `);

        return result.rows[0]?.id ?? '';
    }

    /**
     * Run a statement expected to violate a constraint, and name the constraint PostgreSQL refused it on.
     *
     * Walks the `cause` chain because drizzle wraps the driver's error: the `constraint` field lives on the
     * pg error, and it is the only part of the failure that identifies WHICH rule rejected the row.
     *
     * @param statement - The statement to run.
     * @returns The violated constraint's name, or a description of what happened instead.
     * @sideEffect Executes the statement, which is expected to fail.
     */
    async function violatedConstraint(statement: ReturnType<typeof sql>): Promise<string> {
        try {
            await db.execute(statement);
        } catch (error: unknown) {
            for (let current: unknown = error; current instanceof Error; current = current.cause) {
                const { constraint } = current as { constraint?: unknown };

                if (typeof constraint === 'string') {
                    return constraint;
                }
            }

            return `rejected, but named no constraint: ${String(error)}`;
        }

        return 'accepted — the database did not refuse the row';
    }

    /**
     * Read one correction row by id.
     *
     * @param id - The row to read.
     * @returns The row, or `undefined` when it is gone.
     * @sideEffect Reads `ingredient_parse_corrections`.
     */
    async function readCorrection(id: string): Promise<CorrectionRow | undefined> {
        const result = await db.execute<CorrectionRow>(sql`
            SELECT id, owner_id, source_line, corrected_facts, superseded_at, origin,
                   corroborated_a, corroborated_b
              FROM ingredient_parse_corrections WHERE id = ${id}
        `);

        return result.rows[0];
    }

    it('NULLs owner_id and the typed line TOGETHER', async () => {
        const row = await insertCorrection(OWNER_ERASED, '2 Cups plain flour, sifted');

        await eraseRecipeRows(db, OWNER_ERASED, []);

        const after = await readCorrection(row);

        expect(after).toBeDefined();
        expect(after?.owner_id).toBeNull();
        expect(after?.source_line).toBeNull();
    });

    it('⛔ the database REFUSES a row carrying one without the other, in both directions', async () => {
        // The pair invariant is not a convention the sweep is trusted to honour. Half-sweeping either
        // direction is an unrepresentable state, so a future edit that splits the statement in two fails
        // here rather than in production, where it would aim a later erasure at the wrong person.
        //
        // ⚠️ Asserted on the CONSTRAINT NAME rather than the message: drizzle re-wraps a driver failure as
        // `Failed query: …` and hangs the pg error off `cause`, so a message match would pass for ANY
        // rejection — including a typo'd column — and prove nothing about this constraint.
        expect(
            await violatedConstraint(sql`
                INSERT INTO ingredient_parse_corrections
                    (normalized_key, source_line, corrected_facts, scope, origin, owner_id, surfacing)
                VALUES (${KEY}, ${'2 cups flour'}, ${JSON.stringify(FACTS)}::jsonb, 'author', 'author',
                        NULL, 'recipe-line')
            `),
        ).toBe('ingredient_parse_corrections_owner_line_pair');

        expect(
            await violatedConstraint(sql`
                INSERT INTO ingredient_parse_corrections
                    (normalized_key, source_line, corrected_facts, scope, origin, owner_id, surfacing)
                VALUES (${KEY}, NULL, ${JSON.stringify(FACTS)}::jsonb, 'author', 'author',
                        ${OWNER_ERASED}, 'recipe-line')
            `),
        ).toBe('ingredient_parse_corrections_owner_line_pair');
    });

    it('⛔ never DELETEs the row — the correction survives, de-identified', async () => {
        const row = await insertCorrection(OWNER_ERASED, '2 Cups plain flour, sifted');

        await eraseRecipeRows(db, OWNER_ERASED, []);

        const after = await readCorrection(row);

        // The row is what every OTHER cook's line now parses through. Deleting it — or clearing the
        // correction it carries — would un-correct that line for the whole installation, turning one
        // user's erasure into everybody else's regression.
        expect(after).toBeDefined();
        expect(after?.corrected_facts).toEqual(FACTS);
        expect(after?.superseded_at).toBeNull();
    });

    it('does NOT touch another cook’s live correction', async () => {
        await insertCorrection(OWNER_ERASED, '2 Cups plain flour, sifted');
        const bystander = await insertCorrection(OWNER_BYSTANDER, '2 cups plain flour, sifted');

        await eraseRecipeRows(db, OWNER_ERASED, []);

        const after = await readCorrection(bystander);

        expect(after?.owner_id).toBe(OWNER_BYSTANDER);
        expect(after?.source_line).toBe('2 cups plain flour, sifted');
        expect(after?.superseded_at).toBeNull();
    });

    it('releases the partial unique slot, so an erased cook is not barred from the line forever', async () => {
        await insertCorrection(OWNER_ERASED, '2 Cups plain flour, sifted');

        await eraseRecipeRows(db, OWNER_ERASED, []);

        // `idx_parse_corrections_live_owner` is partial on `owner_id IS NOT NULL`, so a de-identified row
        // stops occupying the `(normalized_key, owner_id)` slot. Without that, exercising the right to
        // erasure would permanently cost the returning user the ability to correct this line.
        await expect(insertCorrection(OWNER_ERASED, '2 cups plain flour')).resolves.not.toBe('');
    });

    it('is idempotent — a redelivered erasure re-runs the sweep against an already-NULL row', async () => {
        const row = await insertCorrection(OWNER_ERASED, '2 Cups plain flour, sifted');

        await eraseRecipeRows(db, OWNER_ERASED, []);
        // The second pass matches nothing (the predicate is `owner_id = $1`, now NULL), and the CHECK is
        // satisfied by the row's current state either way. A sweep that could not survive its own replay
        // would fail the erasure JOB rather than the statement — SQS redelivery is the ordinary case.
        await expect(eraseRecipeRows(db, OWNER_ERASED, [])).resolves.toBeDefined();

        const after = await readCorrection(row);

        expect(after?.owner_id).toBeNull();
        expect(after?.source_line).toBeNull();
        expect(after?.corrected_facts).toEqual(FACTS);
    });
});
