/**
 * `FoodSearchDao` (T-134, MOD-001) — the local-store search read path for `GET /v1/foods/search`. Uses
 * the committed `pg_trgm` GIN indexes (`food_name_trgm_idx` / `food_description_trgm_idx`) for fuzzy +
 * substring + partial name matching over the golden store, returning internal `id`s ranked by trigram
 * similarity (FR-008/FR-010). It NEVER calls a source — search is local-only (FR-009).
 *
 * Only `RESOLVED` foods are surfaced (a served golden record has a golden `name`); in-flight/terminal
 * rows are excluded. Barcode / `external_key` crosswalk lookup is handled by {@link FoodSourcesDao} in
 * the service, not here.
 *
 * @implements FR-008 FR-009 FR-010
 */
import { sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';

/** Max search rows returned (FR-010). */
const SEARCH_LIMIT = 20;

/** A ranked search row. */
export interface SearchHit {
    /** Internal food id. */
    id: string;
    /** Golden display name. */
    name: string | null;
    /** Trigram similarity score against the query. */
    score: number;
}

export class FoodSearchDao {
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Fuzzy/substring/partial search over `RESOLVED` foods, ranked by trigram similarity (FR-008).
     * Matches on a trigram-similar name (`%`, served by the GIN index), or a substring of the name or
     * description (`ILIKE`). Never calls a source.
     *
     * @param query - The trimmed user query.
     * @param limit - Max rows (default 20).
     * @returns Ranked hits, or an empty array when nothing matches.
     * @sideEffect Reads `food`.
     */
    public async search(query: string, limit: number = SEARCH_LIMIT): Promise<SearchHit[]> {
        const pattern = `%${query}%`;
        const result = await this.db.execute<{ id: string; name: string | null; score: number }>(sql`
            SELECT id, name, similarity(name, ${query})::float8 AS score
            FROM food
            WHERE status = 'RESOLVED'
              AND name IS NOT NULL
              AND (name % ${query} OR name ILIKE ${pattern} OR description ILIKE ${pattern})
            ORDER BY score DESC, name ASC
            LIMIT ${limit}
        `);

        return result.rows.map((row) => ({ id: row.id, name: row.name, score: Number(row.score) }));
    }
}
