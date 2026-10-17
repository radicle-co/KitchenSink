/**
 * Every searchable source's adapter (ADR-0055 point 1). A source joins with its entry in the contract's source list
 * and revisions, and an adapter here; the handler does not change. Typed as a Record over the contract's sources, so a
 * source with no adapter fails to compile.
 *
 * @pattern Registry — a typed Record over the contract's source ids
 * @module
 */
import type { RemoteSearchSource } from '../search/remoteSearch.schema.js';
import type { SourceAdapterFactory } from './remoteSourceAdapter.js';
import { createUsdaSearchAdapter } from './usda/usdaSearchAdapter.js';

/** How each source's adapter is built. */
export const SOURCE_ADAPTERS: Readonly<Record<RemoteSearchSource, SourceAdapterFactory>> = Object.freeze({
    usda: createUsdaSearchAdapter,
});
