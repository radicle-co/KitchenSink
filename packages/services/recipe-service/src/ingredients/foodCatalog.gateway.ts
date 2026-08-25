/**
 * Stage 2 / F2 — `FoodCatalogGateway`: the availability-disciplined **Gateway** (PoEAA) in front of
 * food-service's `GET /api/v1/foods/search` for the ingredient typeahead.
 *
 * **Why a gateway and not a direct client call.** Stage 2 puts a CROSS-SERVICE HTTP round-trip on a
 * PER-KEYSTROKE path. That is "no USDA quota", but it is emphatically NOT "instant/local" (plan F2): it adds
 * another service's availability and latency to the typeahead's critical path. This gateway is where that
 * risk is contained, so the calling service holds none of it:
 *
 *  1. **Short transport timeout.** The client is minted per request by {@link FoodServiceClients.typeahead},
 *     which applies a typeahead timeout (hundreds of ms), NOT the 8s default that `addByName`/`getStatus`
 *     legitimately need. The bound is enforced at the transport (a real `AbortSignal`), so a hung food
 *     service does not leak a pending request per keystroke — which a `Promise.race` timeout would.
 *  2. **It NEVER throws.** Every failure — timeout/abort, 5xx, auth, a malformed payload — degrades to
 *     `{ hits: [], availability: 'unavailable' }`. The caller therefore always renders the recipe-local
 *     section; the catalog section is strictly additive. This is the fallback the plan requires, expressed as
 *     a total function rather than a `try/catch` the caller could forget.
 *  3. **Normalization at the boundary.** `SearchResultView.name` is `string | null`; a nameless hit is
 *     unrenderable and unpickable, so it is dropped here rather than leaking a null into the view model.
 *  4. **Log discipline.** A per-keystroke path multiplies a dependency outage into a log flood (cost + noise
 *     that buries the signal). Failures are therefore reported at most once per
 *     {@link FAILURE_LOG_INTERVAL_MS}, with the rest at `debug`.
 *
 * `availability` is a three-state discriminant, not a boolean: `unavailable` (transient degradation, worth
 * telling the user) and `disabled` (an operator switched the blend off — must never surface as an error) are
 * different facts, and only the caller knows how to render each.
 *
 * **The call is made AS THE CALLER** (issue #120). Food verifies a Clerk token, so the only credential that
 * can satisfy it is the requesting user's own, threaded in explicitly as a {@link CallerToken} and handed to
 * {@link FoodServiceClients} — which is also the only thing that knows the food origin, so this gateway
 * cannot aim the credential anywhere else. A caller with NO credential (the non-production dev-auth bypass)
 * degrades exactly like a down food service, and does so WITHOUT issuing a request: an unauthenticated call
 * could only 401, and on a per-keystroke path that would feed food's per-source 401 load-shedder (FR-052),
 * converting our own misconfiguration into a denial of food's auth for everyone behind the same egress IP.
 *
 * @implements FR-007 FR-047
 */
import { Logger } from '@nestjs/common';
import { isFetchUnavailableError } from '@kitchensink/food-service-client';
import type { LiveSearchResultView, SearchResultView } from '@kitchensink/food-service-client';

import type { CallerToken } from '../auth/CallerToken.js';
import type { FoodServiceClients } from './FoodServiceClients.factory.js';
import type { CatalogAvailability, CatalogHit } from './ingredientSuggestion.js';

/** Minimum gap between two `warn`-level degradation reports (a per-keystroke path floods otherwise). */
const FAILURE_LOG_INTERVAL_MS = 60_000;

/** The outcome of one catalog search: the (possibly empty) hits plus WHY they may be empty. */
export interface CatalogSearchOutcome {
    /** The ranked, normalized catalog hits (empty when degraded or disabled). */
    readonly hits: readonly CatalogHit[];
    /** Whether the catalog actually contributed. */
    readonly availability: CatalogAvailability;
}

/** Construction options for {@link FoodCatalogGateway}. */
export interface FoodCatalogGatewayOptions {
    /** Whether the catalog blend is switched on (rollout switch — off means "do not call at all"). */
    readonly enabled: boolean;
}

/** A degraded outcome — the value every failure path collapses to. */
const UNAVAILABLE: CatalogSearchOutcome = { hits: [], availability: 'unavailable' };

/** One hit from the ON-DEMAND live source search — a name, plus our food id when we already hold it. */
export interface LiveCatalogHit {
    /** The source's display name. */
    readonly name: string;
    /** Our opaque food id, present only when the hit is already crosswalked into our catalog. */
    readonly foodId?: string;
}

/**
 * How one ON-DEMAND live search ended (plan U29).
 *
 * ⛔ Three members, not two, and NOT the `CatalogAvailability` triple {@link CatalogSearchOutcome} uses.
 * `search` may flatten every failure into `unavailable` because its result is strictly ADDITIVE — the local
 * section renders regardless and the cook loses nothing they asked for. Here they pressed a button, so the
 * outcomes ARE the product: `results` (possibly empty — the source answered and has nothing, so stop
 * looking), `busy` (our reserved lane is spent, or the source throttled us — try again, and here is when),
 * and `unavailable` (the source did not answer — try again, but we cannot say when). Collapsing any pair
 * strands a cook in the wrong loop.
 */
export type LiveCatalogOutcome =
    | { readonly kind: 'results'; readonly hits: readonly LiveCatalogHit[] }
    | { readonly kind: 'busy'; readonly retryAfterSeconds?: number }
    | { readonly kind: 'unavailable' };

/** The value every live-search failure that is not a rate refusal collapses to. */
const LIVE_UNAVAILABLE: LiveCatalogOutcome = { kind: 'unavailable' };

/** Narrow one raw live row to a renderable {@link LiveCatalogHit}, or `null` when it is unusable. Pure. */
function toLiveHit(row: LiveSearchResultView): LiveCatalogHit | null {
    if (typeof row?.name !== 'string') {
        return null;
    }

    const name = row.name.trim();

    if (name.length === 0) {
        return null;
    }

    // The food service calls its own primary key `id`; this service's ingredient vocabulary calls it
    // `foodId` (see `ingredientSuggestionSchema`). The rename happens HERE, at the boundary, so neither
    // service has to speak the other's dialect.
    return typeof row.id === 'string' && row.id.length > 0 ? { name, foodId: row.id } : { name };
}

/** Narrow one raw search row to a renderable {@link CatalogHit}, or `null` when it is unusable. Pure. */
function toCatalogHit(row: SearchResultView): CatalogHit | null {
    if (typeof row?.id !== 'string' || row.id.length === 0 || typeof row.name !== 'string') {
        return null;
    }

    const name = row.name.trim();

    if (name.length === 0) {
        return null;
    }

    return { foodId: row.id, name, score: typeof row.score === 'number' ? row.score : 0 };
}

export class FoodCatalogGateway {
    private readonly logger = new Logger(FoodCatalogGateway.name);

    /** Epoch ms of the last `warn`-level degradation report (see {@link FAILURE_LOG_INTERVAL_MS}). */
    private lastFailureLogAt = 0;

    /**
     * @param clients - The per-request food-client factory; this gateway only ever asks it for a
     *   {@link FoodServiceClients.typeahead} client (the SHORT deadline — see the class doc).
     * @param options - Whether the blend is enabled.
     */
    public constructor(
        private readonly clients: FoodServiceClients,
        private readonly options: FoodCatalogGatewayOptions,
    ) {}

    /**
     * Search the food-service golden catalog for typeahead suggestions, AS the calling user.
     *
     * **Total by construction — this never rejects.** A slow or unavailable food service yields
     * `availability: 'unavailable'` with no hits, which the caller renders as "local results only".
     *
     * @param caller - The requesting user's credential, forwarded to food. `undefined` (no bearer — the
     *   non-production dev-auth bypass) degrades to `unavailable` with NO request issued; it is never
     *   substituted with another credential.
     * @param query - The (already trimmed) user query. Blank → no call, `ok` with no hits.
     * @param limit - Max hits to keep, applied AFTER ranking. Non-positive → no call.
     * @returns The ranked hits plus whether the catalog contributed. Never throws.
     * @sideEffect Performs one authenticated, short-timeout food-service HTTP request (unless short-circuited).
     */
    public async search(caller: CallerToken | undefined, query: string, limit: number): Promise<CatalogSearchOutcome> {
        if (!this.options.enabled) {
            return { hits: [], availability: 'disabled' };
        }

        const trimmed = query.trim();

        if (trimmed.length === 0 || limit <= 0) {
            return { hits: [], availability: 'ok' };
        }

        if (caller === undefined) {
            // Degrade rather than call unauthenticated (see the class doc: food's 401 shedder).
            this.reportDegraded('no caller credential to forward');

            return UNAVAILABLE;
        }

        try {
            const result = await this.clients.typeahead(caller).search(trimmed);

            if (!Array.isArray(result?.results)) {
                throw new TypeError('food-service search returned no `results` array');
            }

            const usable = result.results.map(toCatalogHit).filter((hit): hit is CatalogHit => hit !== null);
            // Highest score first; ties break on name so the ordering is deterministic across calls. Sorted on
            // a copy — `result` belongs to the caller's response, not to us.
            //
            // ⛔ **This re-sort is what makes food-service's tiered score's UPPER BOUND load-bearing** (plan
            // U5). `FoodsService.search` UNSHIFTS a barcode / external-key crosswalk hit at score exactly
            // `1` — an exact IDENTIFIER match, which must lead — and this line then re-orders the page by
            // score, discarding that position. It stays correct only because `foodRelevance.ts` normalizes
            // the whole tier ladder into `[0, 1)`: a lexical hit can never reach 1. If a future change lets
            // a search score exceed 1, an exact barcode match starts ranking below a fuzzy name match and
            // nothing here would say so. `rankingTiers.test.ts` asserts the bound at the source.
            const hits = [...usable]
                .sort((a, b) => (b.score - a.score !== 0 ? b.score - a.score : a.name.localeCompare(b.name)))
                .slice(0, limit);

            return { hits, availability: 'ok' };
        } catch (error) {
            this.reportDegraded(error);

            return UNAVAILABLE;
        }
    }

    /**
     * ON-DEMAND live source search (plan U29) — the gateway's second, deliberately different path.
     *
     * **Still total by construction; deliberately NOT flattened.** Like {@link search} it never rejects, but
     * it reports THREE outcomes rather than one degraded value — see {@link LiveCatalogOutcome} for why the
     * distinction is the product rather than a nicety.
     *
     * ⚠️ **The STANDARD (8s) client, never the typeahead one.** This is the acknowledged SLOW path: the food
     * service is calling an upstream source over the network, a multi-second wait is the expected experience,
     * and it is explicitly NOT under SC-007's 500ms local-search budget. A sub-second deadline here would
     * turn every real answer into a fabricated "the source did not answer".
     *
     * ⛔ Never call this from a typeahead. Each call spends one request from a SHARED per-IP source quota
     * out of FR-019's reserved interactive lane; it exists for a button a cook presses.
     *
     * @param caller - The requesting user's credential, forwarded to food. `undefined` degrades WITHOUT
     *   issuing a request, exactly as {@link search} does and for the same reason (food's 401 shedder).
     * @param query - The user's query. Passed through as given; food applies the search minimum and refuses
     *   a short one, which surfaces here as `unavailable` (a caller should gate before pressing).
     * @returns Which of the three outcomes occurred. Never throws.
     * @sideEffect Performs one authenticated food-service request that causes an upstream source call.
     */
    public async searchLive(caller: CallerToken | undefined, query: string): Promise<LiveCatalogOutcome> {
        if (!this.options.enabled) {
            // ⚠️ `unavailable`, NOT the `disabled` silence `search` returns. There, silence is right: the
            // local list still works and nothing the cook asked for is missing. Here they pressed a button
            // and are owed an answer, and "the source cannot be searched right now" is the honest one.
            return LIVE_UNAVAILABLE;
        }

        if (caller === undefined) {
            this.reportDegraded('no caller credential to forward');

            return LIVE_UNAVAILABLE;
        }

        try {
            const result = await this.clients.standard(caller).searchLive(query);

            if (!Array.isArray(result?.results)) {
                throw new TypeError('food-service live search returned no `results` array');
            }

            // The source's ORDER is preserved — unlike `search`, there is no score to re-rank by, and the
            // source's own relevance ordering is the only ordering that exists for a hit we do not hold.
            return {
                kind: 'results',
                hits: result.results.map(toLiveHit).filter((hit): hit is LiveCatalogHit => hit !== null),
            };
        } catch (error) {
            if (isFetchUnavailableError(error)) {
                // OUR budget (or the source's) said no — a retryable refusal that names its own window.
                return error.retryAfterSeconds === undefined
                    ? { kind: 'busy' }
                    : { kind: 'busy', retryAfterSeconds: error.retryAfterSeconds };
            }

            this.reportDegraded(error);

            return LIVE_UNAVAILABLE;
        }
    }

    /**
     * Report a degradation, at most once per {@link FAILURE_LOG_INTERVAL_MS} at `warn` and at `debug` in
     * between, so a food-service outage cannot flood the log from a per-keystroke path.
     *
     * Only the failure's own `message` (or its `String()` form) is written — never the error object, so a
     * future field on a food-client error cannot drag anything unexpected into the log. The caller's
     * credential is a {@link CallerToken} that redacts every stringification, and is not passed here at all.
     *
     * @param error - The swallowed failure, or a reason string for a non-throwing degradation.
     * @sideEffect Writes to the logger and advances {@link lastFailureLogAt}.
     */
    private reportDegraded(error: unknown): void {
        const detail = error instanceof Error ? error.message : String(error);
        const message = `Ingredient typeahead degraded to local-only: food catalog search failed (${detail}).`;
        const now = Date.now();

        if (now - this.lastFailureLogAt >= FAILURE_LOG_INTERVAL_MS) {
            this.lastFailureLogAt = now;
            this.logger.warn(message);

            return;
        }

        this.logger.debug(message);
    }
}
