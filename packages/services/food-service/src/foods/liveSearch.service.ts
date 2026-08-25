/**
 * `LiveFoodSearchService` — the ON-DEMAND source search behind the ingredient picker's
 * "Search USDA for '…'" affordance (plan U29; ingredient-search plan §2 Stage 3). It is the ONLY
 * read path in this service that leaves our own database: every other search
 * (`FoodsService.search`) is a local Postgres query over the seeded golden catalog.
 *
 * **Pattern.** A Facade over the adapter Registry + the rolling-window Strategy + the crosswalk DAO,
 * kept out of `FoodsService` on purpose: that class owns the LOCAL store's lifecycle (read,
 * enqueue, resolve, refetch), and an outbound, quota-charging, source-failure-bearing read is a
 * different responsibility with a different failure taxonomy. Folding it in would give one class two
 * reasons to change and hand every local read the source's error paths.
 *
 * ── WHY THIS IS AN EXPLICIT ACTION AND NOT AUTOCOMPLETE ──────────────────────────────────────────
 * The documented USDA limit is 1,000 requests/hour PER IP (ours, not per user — the aggregate limiter
 * is therefore the only quota authority, and this endpoint needs no caller identity to enforce it).
 * FR-019 reserves the top 10% of that for user-facing work. At 50 concurrent cooks, even a PERFECT
 * one-call-per-settled-query autocomplete would want ~3x the entire key — so a debounced-live blend is
 * not a tuning problem, it is arithmetically impossible. ⛔ Do not "improve" this into a keystroke- or
 * debounce-triggered search: it must stay a deliberate, occasional action a cook chooses, which is what
 * makes ~100 reserved calls/hour a workable budget instead of a two-minute outage.
 *
 * ── WHY THE CHARGE COMES BEFORE THE CALL ────────────────────────────────────────────────────────
 * {@link RollingWindowLimiter.tryRecord} is an atomic count-and-record: a denied charge records nothing
 * and, crucially, means the source is never called. Calling first and recording after would make every
 * crash between the two an UNRECORDED source call, which under-counts the window and is exactly how a
 * limiter reports green while breaching the cap (SC-002) — the same durability defect ADR-0024 records
 * for the LLM spend counter, in a different currency.
 *
 * ── THE THREE OUTCOMES, AND WHY THEY ARE THREE ──────────────────────────────────────────────────
 * A cook must be able to tell "the source has nothing for this" (an empty `200`) from "busy, try again"
 * (`503` + `Retry-After`) from "the source did not answer" (`502`). The first means stop looking; the
 * other two mean try again, and only one of them is our own rate limit. That is why a below-minimum
 * query REJECTS here rather than short-circuiting to an empty page the way the local search does — an
 * empty page would be indistinguishable from the first outcome.
 *
 * @implements FR-010a FR-019 FR-020 FR-026 FR-IDN-2
 */
import { Injectable, Logger } from '@nestjs/common';

import { MIN_SEARCH_QUERY_LENGTH, meetsSearchMinimum } from '@kitchensink/recipe-core/resolution/search-minimum';

import { isSourceApiError } from '../sources/foodSource.errors.js';
import type { FoodSourceAdapter, FoodSourceId, SourceCandidate } from '../sources/foodSourceAdapter.js';
import { RollingWindowLimiter } from '../sources/RollingWindowLimiter.js';
import { SourceAdapterRegistry } from '../sources/SourceAdapterRegistry.js';

import { FoodSourcesDao } from './dao/index.js';
import { FetchUnavailableError, SearchQueryTooShortError, SourceUnavailableError } from './foods.errors.js';
import type { LiveSearchResponse, LiveSearchResultView } from './foods.schema.js';

/**
 * The most hits one live search puts on the wire.
 *
 * Twenty is the picker's practical ceiling (the surface shows ten to twenty rows) and it bounds the
 * crosswalk query the results feed. Truncation happens BEFORE the crosswalk so the discarded tail costs
 * no database work either.
 */
export const LIVE_SEARCH_RESULT_LIMIT = 20;

/** Seconds a caller should wait after a lane-exhausted or source-`429` refusal. */
const LIVE_SEARCH_RETRY_AFTER_SECONDS = 60;

/** How one source's attempt ended, so a multi-source fan-out can decide what to tell the caller. */
type SourceAttempt =
    | { readonly kind: 'answered'; readonly source: FoodSourceId; readonly hits: readonly SourceCandidate[] }
    | { readonly kind: 'busy'; readonly source: FoodSourceId }
    | { readonly kind: 'unavailable'; readonly source: FoodSourceId };

@Injectable()
export class LiveFoodSearchService {
    private readonly logger = new Logger(LiveFoodSearchService.name);

    public constructor(
        private readonly registry: SourceAdapterRegistry,
        private readonly limiter: RollingWindowLimiter,
        private readonly foodSources: FoodSourcesDao,
    ) {}

    /**
     * Search every wired source live for `query`, charging each source's RESERVED INTERACTIVE lane.
     *
     * @param query - The cook's typed phrase. Trimmed here; must meet the 003-FR-010a minimum.
     * @returns The (possibly empty) hits, each carrying our internal id when already crosswalked.
     * @throws {SearchQueryTooShortError} `400` — below 003-FR-010a's minimum. Refused rather than emptied,
     *   because an empty page here is indistinguishable from "the source has nothing".
     * @throws {FetchUnavailableError} `503` — the interactive lane is exhausted, or the source said `429`.
     * @throws {SourceUnavailableError} `502` — the source did not answer.
     * @sideEffect Charges the rolling window, calls the source over the network, reads `food_sources`.
     */
    public async search(query: string): Promise<LiveSearchResponse> {
        const trimmed = query.trim();

        if (!meetsSearchMinimum(trimmed)) {
            // ⛔ Refuse, do not empty. See SearchQueryTooShortError for why this route diverges from the
            // local search here, and why the rule lives in the service rather than in the query schema.
            throw new SearchQueryTooShortError(MIN_SEARCH_QUERY_LENGTH);
        }

        const attempts = await Promise.all(
            this.registry.adapters().map(async (adapter) => this.attemptSource(adapter, trimmed)),
        );
        const answered = attempts.filter((attempt) => attempt.kind === 'answered');

        if (answered.length === 0) {
            // Nothing answered. Prefer the BUSY signal when any source gave one: it is the more actionable
            // of the two (it names our own budget and carries a Retry-After) and it is the outcome the
            // reserved lane exists to make rare.
            throw attempts.some((attempt) => attempt.kind === 'busy')
                ? new FetchUnavailableError(LIVE_SEARCH_RETRY_AFTER_SECONDS)
                : new SourceUnavailableError(attempts[0]?.source ?? 'unknown');
        }

        return { results: await this.toResults(answered) };
    }

    /**
     * Charge one source's interactive lane and, if admitted, search it — classifying every failure into
     * the busy/unavailable pair the caller distinguishes.
     *
     * @sideEffect Charges the rolling window and calls the source.
     */
    private async attemptSource(adapter: FoodSourceAdapter, query: string): Promise<SourceAttempt> {
        const source = adapter.source;
        // ⛔ 'interactive', never 'worker'. The whole point of F-W1's lane split is that a cook waiting on
        // this request may spend the reserved top 10% the background drain is shut out of; charging the
        // drain's lane here would refuse them with a tenth of the key unspent.
        const window = await this.limiter.tryRecord(source, 'interactive');

        if (!window.allowed) {
            this.logger.warn('live-search-lane-exhausted', { source, windowCount: window.windowCount });

            return { kind: 'busy', source };
        }

        try {
            return { kind: 'answered', source, hits: await adapter.searchByName(query) };
        } catch (error) {
            if (isSourceApiError(error) && error.statusCode === 429) {
                // Our budget met the source's. Trip the failsafe so the next caller backs off too (FR-026)
                // instead of walking into the same refusal one request at a time.
                this.limiter.markWindowFull(source);
                this.logger.warn('live-search-source-throttled', { source });

                return { kind: 'busy', source };
            }

            // Everything else — a source 5xx, a timeout, or an unclassified adapter fault — reaches the cook
            // as "the source did not answer". An unhandled throw here would surface as a 500 whose body says
            // nothing they can act on.
            this.logger.warn('live-search-source-unavailable', {
                source,
                reason: isSourceApiError(error) ? error.statusCode : 'unclassified',
            });

            return { kind: 'unavailable', source };
        }
    }

    /**
     * Truncate, then crosswalk in ONE batch per source, then project — dropping the source-native key.
     *
     * @sideEffect Reads `food_sources`.
     */
    private async toResults(
        answered: readonly Extract<SourceAttempt, { kind: 'answered' }>[],
    ): Promise<LiveSearchResultView[]> {
        const hits = answered.flatMap((attempt) => attempt.hits).slice(0, LIVE_SEARCH_RESULT_LIMIT);

        if (hits.length === 0) {
            return [];
        }

        const crosswalks = new Map<FoodSourceId, Map<string, string>>();

        for (const source of new Set(hits.map((hit) => hit.source))) {
            const keys = hits.filter((hit) => hit.source === source).map((hit) => hit.externalKey);

            crosswalks.set(source, await this.foodSources.findFoodIdsByExternalKeys(source, keys));
        }

        return hits.map((hit) => {
            const id = crosswalks.get(hit.source)?.get(hit.externalKey);

            return id === undefined ? { name: hit.name } : { name: hit.name, id };
        });
    }
}
