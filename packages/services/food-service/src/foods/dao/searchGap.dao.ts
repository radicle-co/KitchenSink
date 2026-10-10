/**
 * `SearchGapDao` — the one writer of `search_gap` (migration `0022`, ADR-0055 point 4): the wording cooks used for a
 * food our catalog holds under other words, counted per query, source and item, with no user (ADR-0027).
 *
 * A record is one upsert that adds one to each gap's count. The conflict takes the row's lock, so concurrent searches
 * of one gap each count once. It runs after the answer's frame is written, so it bounds itself: every statement ends
 * by {@link SEARCH_GAP_STATEMENT_TIMEOUT_MS}. The prune runs with the call ledger's, once per change-refresh run.
 *
 * @pattern Repository — the one writer of `search_gap`
 * @module
 */
import { sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';
import { localTimeout } from '../../database/localTimeout.js';
import type { SearchGap } from '../domain/remoteHitTriage.js';

/** The longest any statement of a record may run, its row-lock wait included, in milliseconds. */
export const SEARCH_GAP_STATEMENT_TIMEOUT_MS = 500;

/**
 * How long a gap nobody meets again is kept, in days. A curator reads the frequent recent gaps, and a quarter keeps a
 * seasonal ingredient's wording through its season.
 */
export const SEARCH_GAP_RETENTION_DAYS = 90;

const STATEMENT_TIMEOUT = localTimeout('statement_timeout', SEARCH_GAP_STATEMENT_TIMEOUT_MS);

/**
 * The key one gap is counted under. Pure.
 *
 * @param gap - The gap.
 * @returns Its query, source and item key.
 */
function keyOf(gap: SearchGap): string {
    return JSON.stringify([gap.query, gap.source, gap.externalKey]);
}

/**
 * Check a batch can be recorded in one upsert. Pure.
 *
 * @param gaps - The gaps.
 * @returns The same gaps.
 * @throws {RangeError} when two gaps share a key: one statement cannot update a row twice, and the triage that makes
 *   a batch already keeps one per key, so a repeat is a defect.
 */
export function checkedGapBatch(gaps: readonly SearchGap[]): readonly SearchGap[] {
    const keys = new Set(gaps.map(keyOf));

    if (keys.size !== gaps.length) {
        throw new RangeError('A search-gap batch names one query, source and item twice.');
    }

    return gaps;
}

export class SearchGapDao {
    /** @param db - The food-schema Drizzle client. */
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Count each gap once more, or record it for the first time, with the holder and the name as last seen.
     *
     * @param gaps - The gaps one answer found for one source, one per key.
     * @throws {RangeError} from {@link checkedGapBatch}, before any SQL.
     * @throws Any database failure unchanged, including a statement cancelled by `statement_timeout` (57014).
     * @sideEffect Upserts `search_gap`.
     */
    public async record(gaps: readonly SearchGap[]): Promise<void> {
        checkedGapBatch(gaps);

        if (gaps.length === 0) {
            return;
        }

        await this.db.transaction(
            async (tx) => {
                await tx.execute(STATEMENT_TIMEOUT);
                await tx.execute(sql`
                    INSERT INTO search_gap AS gap (query, source, external_key, food_id, food_variant_id, remote_name)
                    SELECT * FROM unnest(
                        ${sql.param(gaps.map((gap) => gap.query))}::text[],
                        ${sql.param(gaps.map((gap) => gap.source))}::food_source[],
                        ${sql.param(gaps.map((gap) => gap.externalKey))}::text[],
                        ${sql.param(gaps.map((gap) => gap.foodId))}::text[],
                        ${sql.param(gaps.map((gap) => gap.foodVariantId))}::text[],
                        ${sql.param(gaps.map((gap) => gap.remoteName))}::text[]
                    )
                    ON CONFLICT (query, source, external_key) DO UPDATE
                       SET occurrences = gap.occurrences + 1,
                           last_seen_at = greatest(gap.last_seen_at, excluded.last_seen_at),
                           food_id = excluded.food_id,
                           food_variant_id = excluded.food_variant_id,
                           remote_name = excluded.remote_name
                `);
            },
            { isolationLevel: 'read committed' },
        );
    }

    /**
     * Delete every gap not seen within the retention period, so the record stays bounded.
     *
     * @param retentionDays - How long an unseen gap is kept, in days.
     * @returns The number of deleted rows.
     * @sideEffect Deletes from `search_gap`.
     */
    public async pruneAged(retentionDays: number = SEARCH_GAP_RETENTION_DAYS): Promise<number> {
        const result = await this.db.execute(sql`
            DELETE FROM search_gap WHERE last_seen_at < now() - make_interval(days => ${retentionDays}::int)
        `);

        return result.rowCount ?? 0;
    }
}
