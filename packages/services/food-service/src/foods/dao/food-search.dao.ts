/**
 * `FoodSearchDao` (T-134/T-180, MOD-001) — the local-store search read path for `GET /api/v1/foods/search`.
 * Combines **ranked full-text search** (the STORED generated `food.search_vector` + `food_search_vector_idx`
 * GIN index, `ts_rank` relevance, word-order-independent lexeme matching) with the committed `pg_trgm` GIN
 * indexes (`food_name_trgm_idx` / `food_description_trgm_idx`) as the **fuzzy/substring/typo fallback** —
 * returning internal `id`s ranked by relevance (FR-008/FR-010). It NEVER calls a source — search is
 * local-only (FR-009), a single SQL read with no adapter/registry seam.
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
    /** Relevance score: the greater of FTS `ts_rank` and `pg_trgm` name similarity. */
    score: number;
}

export class FoodSearchDao {
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Ranked search over `RESOLVED` foods (FR-008/FR-010). A row matches when EITHER the ranked FTS path
     * hits (`search_vector @@ plainto_tsquery('english', query)` — word-order-independent lexeme match
     * over name + description) OR the pg_trgm fuzzy fallback hits (trigram-similar name `%`, or a
     * name/description substring `ILIKE`). The score is `GREATEST(ts_rank, similarity(name))` so a strong
     * full-text relevance OR a strong fuzzy/typo match both rank a row up; ties break on name. Never
     * calls a source.
     *
     * @param query - The trimmed user query.
     * @param limit - Max rows (default 20).
     * @returns Ranked hits, or an empty array when nothing matches.
     * @sideEffect Reads `food`.
     */
    public async search(query: string, limit: number = SEARCH_LIMIT): Promise<SearchHit[]> {
        const pattern = `%${query}%`;
        const result = await this.db.execute<{ id: string; name: string | null; score: number }>(sql`
            SELECT id, name,
                   GREATEST(
                       ts_rank(search_vector, plainto_tsquery('english', ${query})),
                       similarity(name, ${query})
                   )::float8 AS score
            FROM food
            WHERE status = 'RESOLVED'
              AND name IS NOT NULL
              AND (
                  search_vector @@ plainto_tsquery('english', ${query})
                  OR name % ${query}
                  OR name ILIKE ${pattern}
                  OR description ILIKE ${pattern}
              )
            ORDER BY score DESC, name ASC
            LIMIT ${limit}
        `);

        return result.rows.map((row) => ({ id: row.id, name: row.name, score: Number(row.score) }));
    }
}
