/**
 * THE PER-DIGEST LEASE, against a real PostgreSQL.
 *
 * Written RED-first from `docs/plans/2026-09-19-002-feat-parse-once-guarantee-plan.md` §4A.
 *
 * ⛔ ONLY THIS TIER CAN SETTLE IT. Every claim the lease makes is a claim about concurrent access to a row:
 * that two acquirers cannot both hold one key, that an expired lease is indistinguishable from no lease,
 * and that `ON CONFLICT … WHERE` returns zero rows rather than raising when it refuses. An in-memory double
 * returns whatever it was seeded with, in one process, with no row lock — it cannot observe any of them.
 *
 * ⚠️ These tests assert the PRIMITIVE, not the policy. What the worker does when a lease is refused (wait,
 * re-read the cache, then proceed regardless) is the handler's decision and is covered in its own suite.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { acquireParseLease, releaseParseLease } from '../../../src/parsing/parseLease.js';
import { hasTestDatabase, recipeWorkersDb } from '../roleDb.js';

const roleDb = recipeWorkersDb();
const KEY = 'v1:leasetestkey0001';
const OTHER = 'v1:leasetestkey0002';

describe.skipIf(!hasTestDatabase)('the per-digest parse lease (integration)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM ingredient_parse_leases WHERE line_digest LIKE 'v1:leasetestkey%'`);
    });

    afterAll(async () => {
        await pool.end();
    });

    it('grants a lease on a key nobody holds', async () => {
        expect((await acquireParseLease(pool, KEY, 60)).held).toBe(true);
    });

    it('⛔ refuses a second acquirer while the first lease is live — the whole point', async () => {
        expect((await acquireParseLease(pool, KEY, 60)).held).toBe(true);
        expect((await acquireParseLease(pool, KEY, 60)).held).toBe(false);
    });

    it('does not let one key block another', async () => {
        expect((await acquireParseLease(pool, KEY, 60)).held).toBe(true);
        expect((await acquireParseLease(pool, OTHER, 60)).held).toBe(true);
    });

    /**
     * ⛔ THE EXPIRY IS THE MECHANISM, not a nicety. A worker that dies mid-parse leaves its row behind, and
     * without this the digest would be blocked until somebody noticed. A zero-second lease is already past
     * `now()` when the next acquirer reads it, which is exactly the state a dead holder leaves.
     */
    it('⛔ grants a lease whose previous holder has expired', async () => {
        expect((await acquireParseLease(pool, KEY, 0)).held).toBe(true);
        expect((await acquireParseLease(pool, KEY, 60)).held).toBe(true);
    });

    it('releases so the next caller may hold it immediately', async () => {
        const grant = await acquireParseLease(pool, KEY, 60);

        expect(grant.held).toBe(true);
        await releaseParseLease(pool, KEY, grant.held ? grant.fence : '');

        expect((await acquireParseLease(pool, KEY, 60)).held).toBe(true);
    });

    it('tolerates a release of a lease nobody holds, so a double release is not an error', async () => {
        await expect(releaseParseLease(pool, KEY, '2020-01-01 00:00:00+00')).resolves.toBeUndefined();
    });

    /**
     * ⛔ A RELEASE MAY ONLY DELETE THE LEASE IT WAS GRANTED — the fence, and the defect it prevents.
     *
     * Without it this statement matches on `line_digest` alone and deletes whoever holds the row. The
     * sequence that costs a duplicate: A acquires, A's parse outruns the lease, B takes the expired row and
     * begins parsing, then A finishes and deletes B's LIVE lease, leaving the next caller free to call the
     * engines. A zero-second lease is the takeover made deterministic — it is already expired when the
     * second acquirer reads it, which is the state a slow holder leaves.
     */
    it('⛔ does not let a stale holder release the lease that took over from it', async () => {
        const stale = await acquireParseLease(pool, KEY, 0);
        const live = await acquireParseLease(pool, KEY, 60);

        expect(stale.held && live.held).toBe(true);

        // The stale holder finishes and tries to tidy up. It must delete nothing.
        await releaseParseLease(pool, KEY, stale.held ? stale.fence : '');

        // The live holder still holds it, so a third caller is still refused.
        expect((await acquireParseLease(pool, KEY, 60)).held).toBe(false);
    });

    /**
     * Ten acquirers of one key issued together: exactly one is granted.
     *
     * ⚠️ THIS IS A SMOKE TEST, NOT THE ATOMICITY PROOF, and the distinction was measured rather than
     * assumed. Replacing the conditional upsert with a `SELECT` followed by an unconditional `INSERT` —
     * the classic race — leaves this case GREEN: ten `pool.query` calls issued with `Promise.all` are ten
     * round trips, and the event loop serialises them often enough that the first winner's row is already
     * committed before the second acquirer reads. Raising the count would only make the miss intermittent.
     *
     * What this case does earn is that the statement behaves correctly when it IS contended, against a real
     * row lock. The atomicity claim itself is asserted deterministically one tier down, in
     * `src/parsing/__tests__/parseLease.test.ts`, by requiring the acquire to be a single statement.
     */
    it('⛔ admits exactly one of ten simultaneous acquirers', async () => {
        const granted = await Promise.all(Array.from({ length: 10 }, async () => acquireParseLease(pool, KEY, 60)));

        // ⛔ `filter((grant) => grant.held)`, never `filter(Boolean)`: a refusal is the OBJECT
        // `{ held: false }`, which is truthy, so the lazy spelling counts all ten and passes against any
        // implementation at all. It did exactly that here when the return type changed from a boolean.
        expect(granted.filter((grant) => grant.held)).toHaveLength(1);
    });
});
