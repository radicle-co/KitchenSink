/**
 * The boundary every searchable source implements (ADR-0055 point 1): one search of one canonical term, answered with
 * canonical items or a classified failure. Nothing source-specific crosses it.
 *
 * @module
 */
import type { RemoteSearchItem } from '../search/remoteSearch.schema.js';
import type { SecretReader } from '../secrets/secretPorts.js';

/**
 * Response headers the source sent that the caller reads, passed on verbatim: the source's own quota count and its
 * `Retry-After`. The caller parses them with the same rules it applies to the source directly (ADR-0053 §5), so this
 * service parses none of them.
 */
export type PassthroughHeaders = Readonly<Record<string, string>>;

/** How one search of one source ended. */
export type SourceSearchOutcome =
    | {
          readonly kind: 'answered';
          /** The source's hits, in its order. Empty when it has none. */
          readonly items: readonly RemoteSearchItem[];
          readonly passthroughHeaders: PassthroughHeaders;
      }
    | {
          /** The source answered with a status that is not a success. */
          readonly kind: 'sourceStatus';
          readonly sourceStatus: number;
          readonly passthroughHeaders: PassthroughHeaders;
      }
    | {
          /** The source answered a success whose body did not have the shape it publishes. */
          readonly kind: 'invalidResponse';
          readonly passthroughHeaders: PassthroughHeaders;
      }
    | {
          /** The source did not answer usably in time: a timeout, a dropped connection, or a body that is not JSON. */
          readonly kind: 'timeout';
          readonly passthroughHeaders: PassthroughHeaders;
      };

/** One source's search. */
export interface RemoteSourceAdapter {
    /**
     * Search the source once.
     *
     * @param term - The canonical term.
     * @returns The outcome. A failure the adapter cannot classify is thrown.
     * @sideEffect Makes one request to the source, after reading its credential through the connections' reader.
     */
    search(term: string): Promise<SourceSearchOutcome>;
}

/** The process environment, as an adapter reads its own configuration from it. */
export type SourceEnvironment = Readonly<Record<string, string | undefined>>;

/** How an adapter reaches the world: the source, and the secret store its credential lives in. */
export interface SourceConnections {
    /** The `fetch` every source request goes through. */
    readonly fetchFn: typeof fetch;
    /** Reads a credential the environment names by its secret id; the function's reader reads each once. */
    readonly readSecret: SecretReader;
}

/**
 * Builds a source's adapter from its configuration and its connections.
 *
 * @throws {SourceConfigurationError} when the source's configuration is missing or malformed.
 */
export type SourceAdapterFactory = (
    environment: SourceEnvironment,
    connections: SourceConnections,
) => RemoteSourceAdapter;
