/**
 * THE LEASE'S ATOMICITY, asserted deterministically.
 *
 * ⛔ WHY THIS UNIT TEST EXISTS BESIDE AN INTEGRATION SUITE THAT ALREADY RACES TEN ACQUIRERS. It was written
 * after measuring that the integration race does NOT detect the defect it was aimed at: replacing the
 * conditional upsert with a `SELECT` followed by an unconditional `INSERT` left all seven integration cases
 * green. Ten `pool.query` calls issued with `Promise.all` do not reliably interleave — each is a round trip,
 * and the event loop serialises them often enough that the first acquirer's row is already committed before
 * the second's `SELECT` runs. Raising the count would trade a test that misses the defect for one that
 * misses it intermittently, which is worse.
 *
 * ⛔ So the property is asserted directly: **the acquire is ONE statement.** That is not an implementation
 * detail dressed as a test — it is the whole mechanism. Two statements cannot be atomic without a
 * transaction, and a transaction is what this design refuses (it would be held across the engine call). One
 * statement means Postgres's own row lock decides the winner, at any concurrency, with no timing to get
 * lucky with.
 */
import { describe, expect, it } from 'vitest';

import { acquireParseLease, releaseParseLease } from '../parseLease.js';
import type { ParseQueryable } from '../parsePorts.js';

/** A pool that records every statement it is handed and answers as a successful acquire. */
function recordingPool(rows: unknown[] = [{ fence: '2026-01-01 00:00:00+00' }]): ParseQueryable & {
    readonly statements: string[];
} {
    const statements: string[] = [];

    return {
        statements,
        async query(text: string): Promise<{ rows: unknown[] }> {
            statements.push(text);

            return { rows };
        },
    };
}

describe('acquireParseLease', () => {
    it('⛔ issues exactly ONE statement, because the row lock is the whole guarantee', async () => {
        const pool = recordingPool();

        await acquireParseLease(pool, 'v1:k', 60);

        expect(pool.statements).toHaveLength(1);
    });

    it('⛔ conditions the upsert on the existing lease having expired', async () => {
        const pool = recordingPool();

        await acquireParseLease(pool, 'v1:k', 60);

        // Both halves matter: `ON CONFLICT` is what makes a second acquirer see the winner's row under the
        // lock, and the `WHERE` is what lets a dead holder's row be taken over instead of blocking forever.
        expect(pool.statements[0]).toContain('ON CONFLICT (line_digest) DO UPDATE');
        expect(pool.statements[0]).toContain('leased_until < now()');
    });

    it('reads the grant from the returned rows, so zero rows is the refusal', async () => {
        expect((await acquireParseLease(recordingPool([{ fence: '2026-01-01 00:00:00+00' }]), 'v1:k', 60)).held).toBe(
            true,
        );
        expect((await acquireParseLease(recordingPool([]), 'v1:k', 60)).held).toBe(false);
    });

    it('releases with one statement and reports nothing', async () => {
        const pool = recordingPool([]);

        await expect(releaseParseLease(pool, 'v1:k', '2026-01-01 00:00:00+00')).resolves.toBeUndefined();
        expect(pool.statements).toHaveLength(1);
    });
});
