/**
 * The cascade's provenance-event store (plan U2, migration 0035).
 *
 * ⛔ EVENTS, keyed by ingredient, read latest-first — never columns on the shared `ingredients` row. See
 * the migration header for the full argument; the short form: a warm re-reference skips the cascade
 * entirely, so a resolution is a fact about ONE admission at one moment.
 *
 * Two verbs only:
 *
 *  - `record` — one INSERT per cascade resolution, called by `IngredientsService` after a
 *    successful admission. Failures are the CALLER's to swallow (the cascade's own contract is total and
 *    non-throwing for auxiliary work; a lost event degrades to `unattributed` evidence, which is exactly
 *    the pre-U2 behaviour).
 *  - `latestTiersByIngredientIds` — the verification producer's batched read: the most recent
 *    event's tier per ingredient, for the lines of one recipe save. `DISTINCT ON` does the latest-first
 *    collapse in the database, where the `(ingredient_id, created_at)` index serves it.
 */
import { inArray, sql } from 'drizzle-orm';

import { ingredientResolutions } from '../../database/schema/index.js';
import type { RecipeDrizzle } from '../../database/database.module.js';
import type { ResolutionTierId } from './resolutionCascade.js';

/** One resolution event, as the cascade reports it. Ranked fields arrive with the lexical tier (U4). */
export interface ResolutionEvent {
    readonly ingredientId: string;
    readonly tier: ResolutionTierId;
    readonly rung?: string;
    readonly margin?: number;
    readonly shortlist?: unknown;
    readonly bandEpoch?: string;
    readonly queryShape?: string;
    readonly rankerVersion?: string;
}

export class IngredientResolutionsDal {
    public constructor(private readonly db: RecipeDrizzle) {}

    /**
     * Record one resolution event.
     *
     * @param event - What resolved, and how.
     * @sideEffect One INSERT.
     */
    public async record(event: ResolutionEvent): Promise<void> {
        await this.db.insert(ingredientResolutions).values({
            ingredientId: event.ingredientId,
            tier: event.tier,
            rung: event.rung,
            margin: event.margin === undefined ? undefined : String(event.margin),
            shortlist: event.shortlist,
            bandEpoch: event.bandEpoch,
            queryShape: event.queryShape,
            rankerVersion: event.rankerVersion,
        });
    }

    /**
     * The most recent FULL event for each of `ingredientIds` (plan U4 — the producer needs the whole
     * confidence shape, not the tier name alone: the shortlist becomes `ranked` evidence, and the band
     * fields are what authority is consulted under).
     *
     * An ingredient with no event is simply absent from the map — the producer reads absence as
     * `unattributed`, which is a statement, not an error.
     *
     * @param ingredientIds - The lines' ingredient ids, deduplication not required.
     * @returns Latest event by ingredient id. @sideEffect One SELECT.
     */
    public async latestResolutionsByIngredientIds(
        ingredientIds: readonly string[],
    ): Promise<ReadonlyMap<string, LatestResolution>> {
        if (ingredientIds.length === 0) {
            return new Map();
        }

        const rows = await this.db
            .selectDistinctOn([ingredientResolutions.ingredientId], {
                ingredientId: ingredientResolutions.ingredientId,
                tier: ingredientResolutions.tier,
                rung: ingredientResolutions.rung,
                margin: ingredientResolutions.margin,
                shortlist: ingredientResolutions.shortlist,
                queryShape: ingredientResolutions.queryShape,
                rankerVersion: ingredientResolutions.rankerVersion,
                bandEpoch: ingredientResolutions.bandEpoch,
                createdAt: ingredientResolutions.createdAt,
            })
            .from(ingredientResolutions)
            .where(inArray(ingredientResolutions.ingredientId, [...new Set(ingredientIds)]))
            .orderBy(ingredientResolutions.ingredientId, sql`${ingredientResolutions.createdAt} DESC`);

        return new Map(
            rows.map((row) => [
                row.ingredientId,
                {
                    tier: row.tier as ResolutionTierId,
                    rung: row.rung,
                    margin: row.margin === null ? null : Number(row.margin),
                    shortlist: row.shortlist,
                    queryShape: row.queryShape,
                    rankerVersion: row.rankerVersion,
                    bandEpoch: row.bandEpoch,
                    createdAt: row.createdAt,
                },
            ]),
        );
    }
}

/** The latest recorded resolution event, as the verification producer consumes it. */
export interface LatestResolution {
    readonly tier: ResolutionTierId;
    readonly rung: string | null;
    readonly margin: number | null;
    /** The stored `ScoredCandidate[]` snapshot, unvalidated — the producer zod-parses at the boundary. */
    readonly shortlist: unknown;
    readonly queryShape: string | null;
    readonly rankerVersion: string | null;
    readonly bandEpoch: string | null;
    /** When the resolution was made — the clock KTD-A's pending state ages against. */
    readonly createdAt: Date;
}
