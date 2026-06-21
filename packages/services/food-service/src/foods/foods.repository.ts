/**
 * `FoodsRepository` — Drizzle/pg data-access layer for the `/v1/foods/*` read API (ARCH-006,
 * MOD-006). Stateless; the connection pool is held by the long-running process. Reads come from
 * the `kitchensink_food.foods` table; search uses Postgres FTS (`search_vector`) with a
 * `pg_trgm` similarity fallback for misspelled queries (FR-008).
 *
 * @implements FR-001 FR-002 FR-008 FR-009 FR-010
 */
import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import { DrizzleProvider, type FoodDrizzle } from '../database/database.module.js';
import { foods, type FoodRow } from '../db/schema/usda.js';
import type { FoodSearchResult } from './foods.types.js';

/** Max rows returned by full search (FR-010). */
const SEARCH_LIMIT = 20;

/** Max rows returned by autocomplete. */
const AUTOCOMPLETE_LIMIT = 10;

/** Trigram similarity threshold for the fuzzy fallback (e.g. "avacado" → "Avocado"). */
const TRIGRAM_THRESHOLD = 0.3;

/** A raw search row as returned by the FTS/trigram query. */
interface SearchRow {
    fdc_id: number;
    description: string | null;
    data_type: string | null;
    /** `ts_rank`/`similarity` score column (selected but not surfaced). */
    [column: string]: unknown;
}

@Injectable()
export class FoodsRepository {
    public constructor(@Inject(DrizzleProvider) private readonly db: FoodDrizzle) {}

    /**
     * Fetch a single food by FDC id (direct primary-key lookup).
     *
     * @param fdcId - The USDA FoodData Central id.
     * @returns The row, or `null` when no row exists.
     */
    public async findByFdcId(fdcId: number): Promise<FoodRow | null> {
        const rows = await this.db.select().from(foods).where(eq(foods.fdcId, fdcId)).limit(1);

        return rows[0] ?? null;
    }

    /**
     * Full-text + trigram search over the local store. Ranks FTS matches by `ts_rank`; when FTS
     * yields nothing (e.g. a misspelling) falls back to `pg_trgm` similarity on `description`.
     * Never calls USDA (FR-009).
     *
     * @param query - The user query (already trimmed/validated by the service).
     * @param limit - Max rows to return.
     * @returns Ranked results, or an empty array when nothing matches.
     */
    public async search(query: string, limit: number = SEARCH_LIMIT): Promise<FoodSearchResult[]> {
        // FTS first: rank by ts_rank over the maintained search_vector.
        const ftsResult = await this.db.execute<SearchRow>(sql`
            SELECT fdc_id, description, data_type,
                   ts_rank(search_vector, plainto_tsquery('english', ${query})) AS rank
            FROM foods
            WHERE search_vector @@ plainto_tsquery('english', ${query})
            ORDER BY rank DESC
            LIMIT ${limit}
        `);

        const ftsRows = this.extractRows(ftsResult);

        if (ftsRows.length > 0) {
            return ftsRows.map(this.toSearchResult);
        }

        // Fuzzy fallback: pg_trgm similarity on description for misspellings.
        const trgmResult = await this.db.execute<SearchRow>(sql`
            SELECT fdc_id, description, data_type,
                   similarity(description, ${query}) AS sim
            FROM foods
            WHERE description % ${query}
              AND similarity(description, ${query}) >= ${TRIGRAM_THRESHOLD}
            ORDER BY sim DESC
            LIMIT ${limit}
        `);

        return this.extractRows(trgmResult).map(this.toSearchResult);
    }

    /**
     * Autocomplete suggestions — same ranking as {@link search} but capped lower.
     *
     * @param query - The user query.
     * @returns Up to {@link AUTOCOMPLETE_LIMIT} ranked suggestions.
     */
    public async autocomplete(query: string): Promise<FoodSearchResult[]> {
        return this.search(query, AUTOCOMPLETE_LIMIT);
    }

    /**
     * Normalize the driver-shaped result of `db.execute` into a plain row array. `node-postgres`
     * returns `{ rows }`; some drivers return the array directly — handle both.
     */
    private extractRows(result: unknown): SearchRow[] {
        if (Array.isArray(result)) {
            return result as SearchRow[];
        }

        if (result !== null && typeof result === 'object' && 'rows' in result) {
            return (result as { rows: SearchRow[] }).rows;
        }

        return [];
    }

    /** Map a raw search row to the public {@link FoodSearchResult}. */
    private toSearchResult(row: SearchRow): FoodSearchResult {
        return {
            fdcId: row.fdc_id,
            description: row.description,
            dataType: row.data_type,
        };
    }
}
