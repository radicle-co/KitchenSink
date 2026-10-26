/**
 * The cascade's provenance-event store (plan U2, migration 0035).
 *
 * ⛔ EVENTS, keyed by binding, never columns on the shared `food_lookups` row. A warm re-reference skips the cascade
 * entirely, so a resolution is a fact about ONE admission at one moment.
 *
 * ⚠️ WRITE-ONLY since ADR-0071. The events are TELEMETRY: a binding row is shared by every cook who bound that food, so
 * its latest event says what ANOTHER cook's add did, and reading it as this line's provenance marked one cook's wrong
 * line as settled. The producer's read (`latestResolutionsByLookupIds`) and the ranked shape it carried (rung, margin,
 * shortlist, band epoch) were deleted with that read; by-name runs the settled chain only, so it has no ranked shape to
 * write. The columns stay until a later release contracts them (ADR-0035, expand/contract).
 *
 * Failures are the CALLER's to swallow: the cascade's auxiliary work must never fail a resolution that succeeded.
 */
import { ingredientResolutions } from '../../database/schema/index.js';
import type { RecipeDrizzle } from '../../database/database.module.js';
import type { ResolutionTierId } from './resolutionCascade.js';

/** One resolution event: the binding it produced and the tier that produced it. */
export interface ResolutionEvent {
    /** The binding the event produced (a `food_lookups` row, 0051) — bound or unresolved. */
    readonly foodLookupId: string;
    readonly tier: ResolutionTierId;
}

export class IngredientResolutionsDal {
    public constructor(private readonly db: RecipeDrizzle) {}

    /**
     * Record one resolution event.
     *
     * @param event - What resolved, and through which tier.
     * @sideEffect One INSERT.
     */
    public async record(event: ResolutionEvent): Promise<void> {
        await this.db.insert(ingredientResolutions).values({ foodLookupId: event.foodLookupId, tier: event.tier });
    }
}
