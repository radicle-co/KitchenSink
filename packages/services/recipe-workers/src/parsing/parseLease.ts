/**
 * @module parsing/parseLease — a per-digest lease, so two concurrent workers do not both parse a line
 * nobody has answered yet.
 *
 * DESIGN PATTERN: **Lease**, the same shape `parseLine.ts`'s claim applies to a job line — one conditional
 * statement whose zero-row result IS the refusal, and an expiry that makes a dead holder cost one duplicate
 * parse rather than a permanently stuck digest.
 *
 * ## ⛔ It is an OPTIMISATION and must never become a correctness dependency
 *
 * Dedup already has three layers, and all three need an answer to exist: copy-forward refuses to queue a
 * line this owner has answered, `ingredient_parse_cache` answers a line anyone has answered, and the
 * pipeline collapses a line repeated inside one paste. This covers the one case none of them can — a
 * never-answered digest submitted twice at once.
 *
 * So a refusal means "somebody else is asking right now", never "do not ask". A caller that treated it as
 * a denial would strand a cook's line behind a holder that crashed, which is strictly worse than the
 * duplicate call this exists to avoid.
 *
 * ## ⛔ Why a lease and not a lock
 *
 * Nothing here may be held across the engine call. `pg_advisory_lock` would hold a pooled connection for
 * the seconds a parse takes; a row with no expiry would block its digest until somebody noticed. Both fail
 * in the direction that correlates with the incident — a worker dying mid-parse is exactly when the
 * contention this addresses is highest.
 */
import type { ParseQueryable } from './parsePorts.js';

/**
 * What an acquire answers.
 *
 * ⛔ The grant CARRIES ITS FENCE rather than returning a bare `true`, because a release has to prove it
 * still owns what it is deleting — see {@link releaseParseLease}.
 *
 * ⛔ THE FENCE IS TEXT, NOT A `Date`, and that is a correctness requirement rather than a preference.
 * `timestamptz` keeps MICROSECONDS; a JavaScript `Date` keeps milliseconds. Returning one as a `Date`
 * truncates it, so the value sent back could never equal the stored one and every release would silently
 * delete nothing — a fence that refuses everybody is as broken as no fence at all, just in the other
 * direction. Rendered and compared as text, it round-trips exactly.
 */
export type ParseLeaseGrant = { readonly held: true; readonly fence: string } | { readonly held: false };

/**
 * Take the lease for one parse key, if nobody holds a live one.
 *
 * ⛔ ONE STATEMENT, because the guarantee is the row lock. `ON CONFLICT … DO UPDATE … WHERE` re-reads the
 * conflicting row under that lock, so of N simultaneous callers exactly one sees an expired (or absent)
 * row and the rest see the winner's. A `SELECT` followed by an `INSERT` would satisfy every sequential
 * test and admit all N under load, which is the only condition that matters here.
 *
 * ⚠️ Zero rows IS the refusal — the house shape, and the reason this returns a boolean rather than
 * throwing. Refusal is an ordinary outcome, not an error.
 *
 * @param pool - The recipe database.
 * @param lineDigest - The line being parsed. The pipeline asks BOTH engines in one call, so the line is
 *     the indivisible unit of work and therefore of the lease — see the column comment in migration 0049.
 * @param leaseSeconds - How long the holder may take before another caller may proceed regardless.
 * @returns The grant, carrying the fence a release must present; or a refusal.
 * @sideEffect One conditional upsert against `ingredient_parse_leases`.
 */
export async function acquireParseLease(
    pool: ParseQueryable,
    lineDigest: string,
    leaseSeconds: number,
): Promise<ParseLeaseGrant> {
    const held = await pool.query(
        `INSERT INTO ingredient_parse_leases (line_digest, leased_until)
              VALUES ($1, now() + make_interval(secs => $2))
         ON CONFLICT (line_digest) DO UPDATE
                 SET leased_until = excluded.leased_until
               WHERE ingredient_parse_leases.leased_until < now()
           RETURNING leased_until::text AS fence`,
        [lineDigest, leaseSeconds],
    );
    const [row] = held.rows as { fence: string }[];

    return row === undefined ? { held: false } : { held: true, fence: row.fence };
}

/**
 * Give back the lease THIS caller holds, so the next need not wait out its expiry.
 *
 * ⛔ FENCED, and without the fence this statement is a defect rather than a fast path. A release that
 * matched on `line_digest` alone would delete whoever holds the row — including a LATER holder that took
 * over after this caller's lease expired mid-parse. The sequence is: A acquires, A's parse outruns the
 * lease, B takes the expired row and starts parsing, A finishes and deletes B's LIVE lease, and the next
 * caller sails through to the engines. That is precisely the billed duplicate this module exists to
 * prevent, and it compounds — every stale release re-opens the window.
 *
 * ⚠️ `leased_until` IS the fence, so this needs no extra column: two successive holders are granted by
 * different transactions and therefore carry different `now()` values. A caller whose fence no longer
 * matches has genuinely lost the lease, and deleting nothing is the correct outcome.
 *
 * @param pool - The recipe database.
 * @param lineDigest - The line to release.
 * @param fence - The `leased_until` this caller was granted, as text (see {@link ParseLeaseGrant}).
 * @sideEffect One DELETE against `ingredient_parse_leases`.
 */
export async function releaseParseLease(pool: ParseQueryable, lineDigest: string, fence: string): Promise<void> {
    await pool.query(`DELETE FROM ingredient_parse_leases WHERE line_digest = $1 AND leased_until = $2::timestamptz`, [
        lineDigest,
        fence,
    ]);
}

/**
 * The deployed timer, declared once for every wiring that needs one.
 *
 * ⛔ It lives here rather than in each wiring because a lease WAIT that does not actually wait turns the
 * refusal path back into the unbounded duplicate-ask it exists to narrow, and two copies of a timer is
 * exactly the shape that drifts without anything failing.
 *
 * @param milliseconds - How long to wait.
 * @returns A promise that settles after that long. @sideEffect Schedules a timer.
 */
export async function realSleep(milliseconds: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
