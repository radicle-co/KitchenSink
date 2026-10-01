/**
 * `LiveFoodSearchService` — the ON-DEMAND source search behind the ingredient picker's
 * "Search USDA for '…'" affordance (plan U29; ingredient-search plan §2 Stage 3). It is the ONLY
 * read path in this service that leaves our own database: every other search
 * (`FoodsService.search`) is a local Postgres query over the seeded golden catalog.
 *
 * **Pattern.** A Facade over the adapter Registry + the rolling-window Strategy + the catalog owner reader,
 * kept out of `FoodsService` on purpose: that class owns the LOCAL store's lifecycle (read,
 * enqueue, resolve, refetch), and an outbound, quota-charging, source-failure-bearing read is a
 * different responsibility with a different failure taxonomy. Folding it in would give one class two
 * reasons to change and hand every local read the source's error paths.
 *
 * ── WHY THIS IS AN EXPLICIT ACTION AND NOT AUTOCOMPLETE ──────────────────────────────────────────
 * USDA counts 1,000 requests/hour per API key, not per user, so the aggregate limiter is the only quota
 * authority and this endpoint needs no caller identity to enforce it. Every caller (this search, PATCH
 * resolve and the workers) shares one window and one ceiling (`sourceCeiling.ts`). At 50 concurrent
 * cooks, even a PERFECT one-call-per-settled-query autocomplete would want ~3x the entire key — so a
 * debounced-live blend is not a tuning problem, it is arithmetically impossible. ⛔ Do not "improve" this
 * into a keystroke- or debounce-triggered search: it must stay a deliberate, occasional action a cook
 * chooses, or one busy hour of typing empties the window the catalog workers also need.
 *
 * ── WHY THE CHARGE COMES BEFORE THE CALL ────────────────────────────────────────────────────────
 * The registry's client admits every request through the rate-limited transport (ADR-0053 §3) before it
 * is sent: a refused admission records nothing and, crucially, means the source is never called. Calling
 * first and recording after would make every crash between the two an UNRECORDED source call, which
 * under-counts the window and is exactly how a limiter reports green while breaching the cap (SC-002).
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

import { isSourceAccountingError, isSourceApiError, isSourceBusyError } from '../sources/foodSource.errors.js';
import type { FoodSourceAdapter, FoodSourceId, SourceCandidate } from '../sources/foodSourceAdapter.js';
import { SourceAdapterRegistry } from '../sources/SourceAdapterRegistry.js';

import { CatalogOwnerReader, type CatalogOwner } from './catalogOwnerReader.service.js';
import { liveHitView } from './domain/liveHitProjection.js';
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

/** Seconds a caller should wait after a busy, blocked or source-`429` refusal. */
const LIVE_SEARCH_RETRY_AFTER_SECONDS = 60;

/**
 * How one source's attempt ended, so a multi-source fan-out can decide what to tell the caller (ADR-0053 §4):
 * `busy` is our own window at its ceiling or its lock contended, `skipped` is a block a 429, an outage or a low
 * quota wrote, and `unavailable` is a source that did not answer or our own accounting failing.
 */
type SourceAttempt =
    | { readonly kind: 'answered'; readonly source: FoodSourceId; readonly hits: readonly SourceCandidate[] }
    | { readonly kind: 'busy'; readonly source: FoodSourceId }
    | { readonly kind: 'skipped'; readonly source: FoodSourceId }
    | { readonly kind: 'unavailable'; readonly source: FoodSourceId };

@Injectable()
export class LiveFoodSearchService {
    private readonly logger = new Logger(LiveFoodSearchService.name);

    public constructor(
        private readonly registry: SourceAdapterRegistry,
        private readonly owners: CatalogOwnerReader,
    ) {}

    /**
     * Search every wired source live for `query`, charging each source's shared window.
     *
     * @param query - The cook's typed phrase. Trimmed here; must meet the 003-FR-010a minimum.
     * @returns The (possibly empty) hits, each carrying our internal id when already crosswalked.
     * @throws {SearchQueryTooShortError} `400` — below 003-FR-010a's minimum. Refused rather than emptied,
     *   because an empty page here is indistinguishable from "the source has nothing".
     * @throws {FetchUnavailableError} `503` — no source answered and one was busy or blocked.
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
            // Nothing answered. Prefer the BUSY signal when any source was busy or blocked: it is the more
            // actionable of the two (it means "try again" and carries a Retry-After), and a blocked source is
            // never "the source did not answer" — we did not ask it.
            throw attempts.some((attempt) => attempt.kind === 'busy' || attempt.kind === 'skipped')
                ? new FetchUnavailableError(LIVE_SEARCH_RETRY_AFTER_SECONDS)
                : new SourceUnavailableError(attempts[0]?.source ?? 'unknown');
        }

        return { results: await this.toResults(answered) };
    }

    /**
     * Search one source — the registry's client admits the request against the source's window first — and
     * classify every failure into the busy/skipped/unavailable outcomes the caller distinguishes.
     *
     * @sideEffect Charges the rolling window and calls the source.
     */
    private async attemptSource(adapter: FoodSourceAdapter, query: string): Promise<SourceAttempt> {
        const source = adapter.source;

        try {
            return { kind: 'answered', source, hits: await adapter.searchByName(query) };
        } catch (error) {
            if (isSourceBusyError(error)) {
                // Refused before the source was asked (ADR-0053 §4): a block is `skipped`, our own window at its
                // ceiling or its lock contended is `busy`.
                this.logger.warn('live-search-source-refused', {
                    source,
                    reason: error.reason,
                    retryAt: error.retryAt,
                });

                return { kind: error.reason === 'blocked' ? 'skipped' : 'busy', source };
            }

            if (isSourceApiError(error) && error.statusCode === 429) {
                // Our budget met the source's. The transport has already written the block every task reads
                // (FR-026), so the next caller is refused without asking the source.
                this.logger.warn('live-search-source-throttled', { source });

                return { kind: 'skipped', source };
            }

            if (isSourceAccountingError(error)) {
                // Our own admission or block ledger failed — logged as ours, never as the source's.
                this.logger.error('live-search-accounting-failed', {
                    source,
                    step: error.step,
                    cause: String(error.cause),
                });

                return { kind: 'unavailable', source };
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
     * Truncate, then resolve each hit's owner in ONE batch per source, then project — dropping the source-native
     * key. A hit on an item the catalog holds is shown under the root that stands for it (curated U8, R19).
     *
     * @sideEffect Reads the crosswalk, citations, forwards, variants and roots through the owner reader.
     */
    private async toResults(
        answered: readonly Extract<SourceAttempt, { kind: 'answered' }>[],
    ): Promise<LiveSearchResultView[]> {
        const hits = answered.flatMap((attempt) => attempt.hits).slice(0, LIVE_SEARCH_RESULT_LIMIT);

        if (hits.length === 0) {
            return [];
        }

        // One batched read per distinct source, and the sources are independent of each other — so they go
        // together rather than in series, on a path the docstring already concedes is the slow one.
        const owners = new Map<FoodSourceId, Map<string, CatalogOwner>>(
            await Promise.all(
                [...new Set(hits.map((hit) => hit.source))].map(
                    async (source): Promise<[FoodSourceId, Map<string, CatalogOwner>]> => [
                        source,
                        await this.owners.ownersOfKeys(
                            source,
                            hits.filter((hit) => hit.source === source).map((hit) => hit.externalKey),
                        ),
                    ],
                ),
            ),
        );

        return hits.map((hit) => liveHitView(hit, owners.get(hit.source)?.get(hit.externalKey)));
    }
}
