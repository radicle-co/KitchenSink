/**
 * The profile's clock — the ONE expression every statement that changes a byline stamps `profiles.updated_at` (and
 * `handle_sync_owed_at`) with (plan 2026-10-15-010 D6).
 *
 * ⛔ WHY THE DATABASE STAMPS IT, NOT THE PROCESS. The handle-sync consumer applies byline snapshots monotonically on
 * this stamp, so "the last writer carries the highest key AND the whole state" must hold. Two writers race on one
 * profile — `PATCH /users/me` and the Clerk `user.updated` webhook. With a process clock, PATCH stamps T1, the
 * webhook T2 > T1, PATCH commits LAST carrying both changes, and the consumer refuses its newer state for good.
 * Stamped here instead, inside the UPDATE, the row lock serialises the two and READ COMMITTED re-evaluates the SET
 * against the committed row, so whichever commits second also stamps second.
 *
 * ⚠️ MILLISECONDS, and strictly increasing. A JS `Date` holds milliseconds, so a microsecond stamp would not survive
 * the round trip: `settleHandleSync`'s equality check would never match, and two writes inside one millisecond
 * would collapse to one key. `GREATEST(…, updated_at + 1 ms)` makes every write move the key forward even then.
 *
 * Usable only where the row being written is `profiles` (an UPDATE's SET), since it reads the row's own clock.
 */
import { sql, type SQL } from 'drizzle-orm';

import { profiles } from './schema/profiles.js';

/** `GREATEST(now at millisecond precision, the row's previous stamp + 1 ms)`. */
export const profileClock: SQL = sql`GREATEST(date_trunc('milliseconds', statement_timestamp()), ${profiles.updatedAt} + interval '1 millisecond')`;
