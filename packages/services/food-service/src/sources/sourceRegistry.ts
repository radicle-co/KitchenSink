/**
 * The ONE composition of the wired source adapters (FR-ADP-1, ADR-0053 §3). Every source client is built here, over
 * the rate-limited transport, so every upstream request is admitted against its source's declared limit and every
 * block a response earns is written where every task reads it. A guard holds `new UsdaApiClient(` to this file.
 *
 * Each process composes it once, on its own lane: the API on `interactive` (live search, PATCH resolve), the worker
 * and change-refresh on `worker`. Credentials and the base URL come from the ONE validated reader, so a missing key or
 * a malformed URL fails at composition, naming the variable, rather than on the first fan-out.
 *
 * @pattern Factory — a composition root's worth of wiring behind one function, shared by the three roots
 * @implements FR-ADP-1 FR-019 FR-026
 */
import { UsdaApiClient } from '@kitchensink/usda-client';

import { settingFromEnv } from '../config/env.schema.js';
import { FoodMetrics } from '../observability/emfMetrics.js';
import { isSourceAdmissionError } from './foodSource.errors.js';
import { SourceAdapterRegistry } from './SourceAdapterRegistry.js';
import {
    RateLimitedTransport,
    type AdmissionPolicy,
    type BlockLedger,
    type FetchFn,
    type QuotaMetrics,
    type SourceCallChannel,
} from './transport/RateLimitedTransport.js';
import { UsdaSourceAdapter } from './usda/usda.adapter.js';

/** What the registry is composed over. */
export interface SourceRegistryDeps {
    /** The lane every call this process makes is charged to. */
    readonly lane: SourceCallChannel;
    /** Admission: the limiter, in production. */
    readonly admission: AdmissionPolicy;
    /** The block ledger: `SourceBackoffDao`, in production. */
    readonly blocks: BlockLedger;
    /** Where the publisher's quota reading goes. Defaults to EMF. */
    readonly metrics?: QuotaMetrics;
    /** The real `fetch`, which only the transport calls. Defaults to the global one; tests inject a double. */
    readonly upstream?: FetchFn;
}

/**
 * Build the registry, every source client wired through the transport.
 *
 * @param deps - The lane, admission, the block ledger, and optionally the quota sink and the real `fetch`.
 * @returns A registry holding the `usda` adapter.
 * @throws {Error} naming the variable when `USDA_API_KEY` is absent or `USDA_API_BASE_URL` is malformed.
 * @sideEffect Reads `process.env`.
 */
export function createSourceRegistry(deps: SourceRegistryDeps): SourceAdapterRegistry {
    const transport = new RateLimitedTransport({
        admission: deps.admission,
        blocks: deps.blocks,
        metrics: deps.metrics ?? new FoodMetrics(),
        upstream: deps.upstream ?? globalThis.fetch,
    });
    const registry = new SourceAdapterRegistry();

    registry.register(
        new UsdaSourceAdapter(
            new UsdaApiClient({
                apiKey: settingFromEnv('USDA_API_KEY'),
                baseUrl: settingFromEnv('USDA_API_BASE_URL'),
                fetchFn: transport.fetchFor('usda', deps.lane),
                isCallerError: isSourceAdmissionError,
            }),
        ),
    );

    return registry;
}
