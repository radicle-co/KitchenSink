/**
 * The recipe search's food filter, widened from a ROOT to the root's live variants (curated plan U9).
 *
 * A cook filtering on "beef brisket" means every brisket line, whichever variant it is bound to. Recipe holds no food
 * facts and ADR-0006 forbids a join into food's database, so each filtered root is expanded through food's own read
 * of it — `GET /api/v1/foods/{id}`, whose `variants` are the root's LIVE variants — asked AS THE CALLER, the house
 * rule for every food call (issue #120). The SQL then matches a line bound to the root or to one of those variants.
 *
 * ## Three answers, kept apart
 *
 * - **200** — the root's live variant ids.
 * - **A definite answer that names none** — a pending root (202), an unknown or concealed root (404), a malformed id
 *   (400). The root still filters on its own lines; it simply has no variants to add.
 * - **No answer** — a transport failure, a 5xx, or no caller credential to ask with. ⛔ That is `502
 *   SOURCE_UNAVAILABLE`, never a filter run without some variants: a partial filter would report "no recipe uses
 *   this food" for recipes that do.
 *
 * One WAVE: every root is asked at once. The wire bounds the filter (`MAX_SEARCH_FOOD_FILTERS`) so that a wave is
 * small; nothing here chunks.
 *
 * ⚠️ A filter does not match a line bound to a variant the seed has since retired, nor to a binding food forwarded
 * away after it was made: admission binds the live end, and only the live end is expanded.
 *
 * @pattern Gateway + Anti-Corruption Layer over `@kitchensink/food-service-client`
 */
import { Logger } from '@nestjs/common';
import { isBadRequestError, isNotFoundError, type GetFoodResult } from '@kitchensink/food-service-client';

import type { CallerToken } from '../auth/CallerToken.js';
import { apiError } from '../common/apiError.js';
import type { FoodServiceClients } from '../ingredients/FoodServiceClients.factory.js';

/** A food filter in the two arms the SQL matches on. */
export interface FoodFilter {
    /** The roots the cook named. */
    readonly rootIds: readonly string[];
    /** Those roots' live variants, as food answered on this read. */
    readonly variantIds: readonly string[];
}

/**
 * The live variant ids a root read names, or none for a root that is not (yet) resolved. Pure.
 *
 * @param result - Food's answer to `GET /{id}`.
 * @returns The variant ids.
 */
function variantIdsOf(result: GetFoodResult): readonly string[] {
    return result.status === 'RESOLVED' ? result.food.variants.map((variant) => variant.id) : [];
}

export class FoodFilterExpansionGateway {
    private readonly logger = new Logger(FoodFilterExpansionGateway.name);

    /** @param clients - The per-caller food client factory. */
    public constructor(private readonly clients: FoodServiceClients) {}

    /**
     * Expand the filtered roots to the filter's two arms.
     *
     * @param caller - The searching cook's credential, forwarded to food; no other credential is substituted.
     * @param rootIds - The roots the cook filtered on (bounded by the wire).
     * @returns The roots and their live variants.
     * @throws {HttpException} `502 SOURCE_UNAVAILABLE` when food cannot answer for every root.
     * @sideEffect One food read per root, all concurrent.
     */
    public async expand(caller: CallerToken | undefined, rootIds: readonly string[]): Promise<FoodFilter> {
        if (rootIds.length === 0) {
            return { rootIds: [], variantIds: [] };
        }

        if (caller === undefined) {
            this.logger.warn('food filter not expanded: no caller credential to forward', { roots: rootIds.length });

            throw apiError('SOURCE_UNAVAILABLE', 'The food service could not be asked about the filtered foods.');
        }

        const client = this.clients.standard(caller);
        const settled = await Promise.allSettled(rootIds.map((id) => client.getById(id)));
        const variantIds: string[] = [];

        for (const outcome of settled) {
            if (outcome.status === 'fulfilled') {
                variantIds.push(...variantIdsOf(outcome.value));
                continue;
            }

            if (isNotFoundError(outcome.reason) || isBadRequestError(outcome.reason)) {
                continue;
            }

            this.logger.warn('food filter expansion failed; the search is refused rather than run partially', {
                reason: outcome.reason instanceof Error ? outcome.reason.message : 'unknown error',
            });

            throw apiError('SOURCE_UNAVAILABLE', 'The food service did not answer for every filtered food.');
        }

        return { rootIds: [...rootIds], variantIds: [...new Set(variantIds)] };
    }
}
