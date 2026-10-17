/**
 * How food asks one remote source for a search (ADR-0055 points 3, 4 and 6). The progressive search asks every source
 * through this port and writes each outcome as that source's frame; the search service's Adapter and the Null Object
 * for a stage without one both implement it.
 *
 * @module
 */
import type { RemoteSearchItem, RemoteSearchSource } from '@kitchensink/schema-remote-search';

/** How one source's search ended. Every failure is one of these; a search never rejects. */
export type RemoteSourceOutcome =
    | {
          readonly kind: 'answered';
          /** The source's hits, in its order, as the search service mapped them. Empty when it has none. */
          readonly items: readonly RemoteSearchItem[];
      }
    | {
          /** The source's shared window is full or blocked: try later. */
          readonly kind: 'busy';
          readonly retryAfterSeconds: number;
      }
    | {
          /** The cook's own hourly source budget is spent. */
          readonly kind: 'limited';
          readonly retryAfterSeconds: number;
      }
    | {
          /** No usable answer: the search service, the source, or our own accounting failed, or it was not asked. */
          readonly kind: 'unavailable';
      };

/** One search of one source. */
export interface RemoteSearchRequest {
    readonly source: RemoteSearchSource;
    /** The canonical term (`searchTermQuerySchema`). */
    readonly term: string;
    /** The requester key whose hourly source budget a miss is charged to. */
    readonly requesterId: string;
    /** Ends the wait for a cached answer. A call already admitted still runs to completion. */
    readonly signal: AbortSignal;
}

/** Searches one remote source. */
export interface RemoteSearchPort {
    /**
     * Search one source for a term.
     *
     * @param request - The source, the term, the requester and the caller's signal.
     * @returns How the search ended. Never rejects.
     * @sideEffect May call the search service, charge the requester's budget and the shared window, and write a block.
     */
    search(request: RemoteSearchRequest): Promise<RemoteSourceOutcome>;
}
