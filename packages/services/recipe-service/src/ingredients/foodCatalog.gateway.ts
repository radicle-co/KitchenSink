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
import type { SearchResultView } from '@kitchensink/food-service-client';

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
