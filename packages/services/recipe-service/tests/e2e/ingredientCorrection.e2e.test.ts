/**
 * U14 — `POST /api/v1/ingredients/corrections` through the fully ASSEMBLED recipe app (plan U14 / R19, R20).
 *
 * What only this tier establishes, and why the controller unit suite is not enough: the unit test calls the
 * controller METHOD, so it sees none of the machinery a real caller passes through. Every claim below lives
 * in that machinery:
 *
 *  1. **The `ZodValidationPipe` is actually bound to this route.** A `createZodDto` class carries no
 *     `class-validator` metadata, so under Nest's own `ValidationPipe` it would validate NOTHING while
 *     looking correctly wired — a body with a 10,000-character phrase would reach the database.
 *  2. **The path resolves.** `POST corrections` sits in a controller that also declares `POST :id/resolve`;
 *     only real routing proves `corrections` is not swallowed as a path parameter.
 *  3. ⛔ **The write actually reaches `ingredient_resolution_mappings`.** U10 shipped this write path with no
 *     caller at all; this is the first tier where a real HTTP request produces a real row, which is the
 *     entire content of U14's verification line ("a user correction reaches the mapping table").
 *  4. **The strict body rejects what it must not trust.** `scope` is an OUTPUT of a pure policy reading
 *     signed grants — a caller that could declare it would hand themselves global reach.
 *
 * ⚠️ The GRANTED path (a curator binding globally on first correction) is NOT exercised here: the harness's
 * dev-auth bypass mints a principal with no scopes, and forging one would be asserting against a token this
 * service would never accept. That branch is a truth table in `mappingScopePolicy.test.ts` and is proven
 * end-to-end against the DAL in `resolutionMappingsDal.integration.test.ts`.
 *
 * Skips when no test database is configured.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/** The correcting caller (the harness's dev-auth bypass identity for this suite). */
const CALLER = '01JU14CORRECTIONE2ECALLER0A';

/** The phrase this suite corrects. Normalized, it is the key the cascade would later look up. */
const PHRASE = 'E2E plain flour';

/** The food the phrase is corrected to. Opaque; never verified against the food service, by design. */
const FOOD_ID = '01JU14CORRECTIONFOOD00001';

/** U+200B ZERO WIDTH SPACE — an escape, because a reviewer cannot check a case they cannot see. */
const ZWSP = '​';

describe.skipIf(!hasDatabaseUrl)('ingredient correction surface (e2e, assembled app)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: CALLER });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
    });

    afterEach(async () => {
        await pool.query('DELETE FROM ingredient_resolution_mappings WHERE user_id = $1', [CALLER]);
    });

    afterAll(async () => {
        await pool.end();
        await booted?.close();
    });

    /** POST a correction body and return the status plus the parsed JSON. */
    async function correct(body: Record<string, unknown>): Promise<{ status: number; json: unknown }> {
        const response = await fetch(`${baseUrl}/api/v1/ingredients/corrections`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });

        return { status: response.status, json: await response.json().catch(() => undefined) };
    }

    /** A valid correction body, with `over` layered on top. */
    const validBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
        phrase: PHRASE,
        foodId: FOOD_ID,
        surfacing: 'ingredient_picker',
        ...over,
    });

    // ⛔ Claim 3 — the verification line of the whole unit.
    it('⛔ writes a real row, and reports the reach the server decided', async () => {
        const { status, json } = await correct(validBody());

        expect(status).toBe(200);
        expect(json).toEqual({ recorded: true, mappingId: expect.any(String), scope: 'author' });

        const { rows } = await pool.query<{ food_id: string; scope: string; origin: string; surfacing: string }>(
            'SELECT food_id, scope, origin, surfacing FROM ingredient_resolution_mappings WHERE user_id = $1',
            [CALLER],
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            food_id: FOOD_ID,
            // An ungranted caller binds only themselves — the grant purely elevates, and there is no field a
            // caller can send to ask for more.
            scope: 'author',
            origin: 'author',
            surfacing: 'ingredient_picker',
        });
    });

    it('persists the RAW phrase beside the normalized key, so a key change is a backfill not data loss', async () => {
        await correct(validBody());

        const { rows } = await pool.query<{ normalized_key: string; source_phrase: string }>(
            'SELECT normalized_key, source_phrase FROM ingredient_resolution_mappings WHERE user_id = $1',
            [CALLER],
        );

        expect(rows[0]?.source_phrase).toBe(PHRASE);
        // The key is the MATCH grain: case-folded, so two cooks spelling the phrase differently collide on it.
        expect(rows[0]?.normalized_key).toBe(PHRASE.toLowerCase());
    });

    // ⚠️ A no-op is a 200. Answering 4xx would make a surface render "something went wrong" for the
    // idempotent happy path a cook reaches by correcting the same phrase twice.
    it('⚠️ answers 200 `recorded: false` on a re-assertion, and writes no second row', async () => {
        await correct(validBody());
        const { status, json } = await correct(validBody());

        expect(status).toBe(200);
        expect(json).toEqual({ recorded: false, outcome: 'already_in_force' });

        const { rows } = await pool.query('SELECT id FROM ingredient_resolution_mappings WHERE user_id = $1', [CALLER]);

        // ⛔ Exactly ONE. A churn row per re-open would inflate the corroboration count that decides
        // promotion, turning "two independent authors agreed" into "somebody visited the line twice".
        expect(rows).toHaveLength(1);
    });

    // ⛔ Claim 4. `scope` is decided, never declared.
    it('⛔ REJECTS a body declaring its own scope — reach is an output, not an input', async () => {
        const { status } = await correct(validBody({ scope: 'global' }));

        expect(status).toBe(400);
    });

    it('REJECTS a caller-supplied identity, under EITHER spelling — nobody writes as somebody else', async () => {
        // ⚠️ BOTH spellings, since migration 0033 renamed the column `author_id` → `user_id` (ADR-0027). The
        // request body has never carried either — identity comes from the verified principal — and the
        // `z.strictObject` boundary is what makes that unforgeable. Asserting only the OLD name would let a
        // future `userId` field slip in under a test that reads as though it covers this.
        expect((await correct(validBody({ authorId: '01JSOMEONEELSE0000000000AA' }))).status).toBe(400);
        expect((await correct(validBody({ userId: '01JSOMEONEELSE0000000000AA' }))).status).toBe(400);
    });

    it('REJECTS a surfacing outside the published vocabulary, keeping the audit dimension aggregable', async () => {
        expect((await correct(validBody({ surfacing: 'somewhere_else' }))).status).toBe(400);
    });

    // Claim 1 — the pipe is bound, so the bounds are enforced on the wire rather than at the column.
    it.each([
        ['a blank phrase', { phrase: '   ' }],
        ['an over-long phrase', { phrase: 'a'.repeat(121) }],
        ['a blank foodId', { foodId: '  ' }],
        ['an over-long foodId', { foodId: 'f'.repeat(65) }],
        ['a missing surfacing', { surfacing: undefined }],
    ])('answers 400 for %s', async (_label, over) => {
        expect((await correct(validBody(over))).status).toBe(400);
    });

    // ⛔ `min(1)` PASSES for a zero-width character, and the normalized key is then empty. Reporting that as
    // "already in force" would tell the caller their correction was redundant when it was never usable.
    it('⛔ answers 400 — not a silent no-op — for a phrase of zero-width characters', async () => {
        const { status } = await correct(validBody({ phrase: `${ZWSP}${ZWSP}` }));

        expect(status).toBe(400);

        const { rows } = await pool.query('SELECT id FROM ingredient_resolution_mappings WHERE user_id = $1', [CALLER]);

        expect(rows).toHaveLength(0);
    });

    it('never leaks the policy’s internal reason prose to a caller', async () => {
        await correct(validBody());
        const { json } = await correct(validBody());

        expect(JSON.stringify(json)).not.toContain('The caller already holds');
    });
});
