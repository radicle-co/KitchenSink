/**
 * The sources the progressive search asks remotely: every source the search service searches (ADR-0055 point 1).
 *
 * Each is also a callable source in food's own register, because food admits every call against the source's window
 * and applies its block rule (point 6). {@link Admissible} makes a search-service source that food cannot admit a
 * compile error here, rather than a source asked with no limit.
 *
 * @module
 */
import { remoteSearchSourceSchema, type RemoteSearchSource } from '@kitchensink/schema-remote-search';

import type { CallableApiSourceId } from '../sourceRegister.js';

/** A source the search service searches, which food can admit a call to. Fails to compile otherwise. */
type Admissible<Source extends CallableApiSourceId> = Source;

/** Every source to ask, in the search service's order. */
export const REMOTE_SEARCH_SOURCES: readonly Admissible<RemoteSearchSource>[] = remoteSearchSourceSchema.options;
