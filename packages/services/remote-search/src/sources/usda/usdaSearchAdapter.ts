/**
 * USDA FoodData Central's search, through the shared `@kitchensink/usda-client`: its one search statement, its one
 * hit mapping, and its error classes. The adapter adds what this service needs on top: each failure as a typed
 * outcome, and the response headers the caller reads, passed on verbatim.
 *
 * The API key is read from the secret the environment names, when the adapter searches, and goes only into the
 * request the client builds. Nothing the adapter returns or throws carries it: an outcome holds mapped items, a status
 * and named headers, and a configuration failure names variables.
 *
 * @pattern Adapter — the USDA client behind the source-agnostic `RemoteSourceAdapter` port
 * @module
 */
import {
    isUsdaNotFoundError,
    isUsdaRateLimitError,
    isUsdaSchemaError,
    isUsdaServerError,
    isUsdaTimeoutError,
    UsdaApiClient,
    USDA_QUOTA_HEADERS,
    usdaSearchCandidate,
} from '@kitchensink/usda-client';
import { z } from 'zod';

import type {
    PassthroughHeaders,
    RemoteSourceAdapter,
    SourceConnections,
    SourceEnvironment,
    SourceSearchOutcome,
} from '../remoteSourceAdapter.js';
import { SourceConfigurationError } from '../sourceConfigurationError.js';

/**
 * The adapter's configuration: the id of the secret holding the API key, never the key. The base URL is the client's
 * own default unless a test points it elsewhere.
 */
const usdaEnvironmentSchema = z.object({
    USDA_API_KEY_SECRET_ID: z.string().min(1),
    USDA_API_BASE_URL: z.url().optional(),
});

/** The USDA response headers the caller reads: api.data.gov's quota count, and the block signal (ADR-0053 §5). */
const PASSTHROUGH_HEADER_NAMES = [
    USDA_QUOTA_HEADERS.remainingHeader,
    USDA_QUOTA_HEADERS.limitHeader,
    'Retry-After',
] as const;

/** A `fetch` that remembers the headers of the response it last received. */
interface RecordingFetch {
    readonly fetchFn: typeof fetch;
    readonly headers: () => Headers | undefined;
}

/**
 * Wrap a `fetch` so the response's headers can be read after the client has consumed the response. The client
 * returns only the parsed body and throws on a failure status, so this is where the headers are kept.
 *
 * @param fetchFn - The `fetch` to call.
 * @returns The wrapper.
 */
function recordingFetch(fetchFn: typeof fetch): RecordingFetch {
    let received: Headers | undefined;

    return {
        fetchFn: async (input, init) => {
            const response = await fetchFn(input, init);

            received = response.headers;

            return response;
        },
        headers: () => received,
    };
}

/**
 * The headers to pass on, by their declared names. Pure.
 *
 * @param headers - The source's response headers, or `undefined` when no response arrived.
 * @returns The headers present, verbatim.
 */
function passthroughOf(headers: Headers | undefined): PassthroughHeaders {
    return Object.fromEntries(
        PASSTHROUGH_HEADER_NAMES.flatMap((name) => {
            const value = headers?.get(name) ?? null;

            return value === null ? [] : [[name, value]];
        }),
    );
}

/**
 * Classify a client failure. Pure.
 *
 * @param error - What the client threw.
 * @param passthroughHeaders - The headers to pass on.
 * @returns The outcome.
 * @throws The error itself, when it is not one of the client's classes.
 */
function failureOf(error: unknown, passthroughHeaders: PassthroughHeaders): SourceSearchOutcome {
    if (isUsdaRateLimitError(error)) {
        return { kind: 'sourceStatus', sourceStatus: 429, passthroughHeaders };
    }

    if (isUsdaNotFoundError(error)) {
        return { kind: 'sourceStatus', sourceStatus: 404, passthroughHeaders };
    }

    if (isUsdaServerError(error)) {
        return { kind: 'sourceStatus', sourceStatus: error.status, passthroughHeaders };
    }

    if (isUsdaSchemaError(error)) {
        return { kind: 'invalidResponse', passthroughHeaders };
    }

    if (isUsdaTimeoutError(error)) {
        return { kind: 'timeout', passthroughHeaders };
    }

    throw error;
}

/**
 * Build the USDA adapter.
 *
 * @param environment - The process environment: `USDA_API_KEY_SECRET_ID`, and optionally `USDA_API_BASE_URL`.
 * @param connections - The `fetch` every request goes through, and the secret read the key comes through.
 * @returns The adapter.
 * @throws {SourceConfigurationError} naming each variable that is missing or malformed.
 */
export function createUsdaSearchAdapter(
    environment: SourceEnvironment,
    { fetchFn, readSecret }: SourceConnections,
): RemoteSourceAdapter {
    const parsed = usdaEnvironmentSchema.safeParse(environment);

    if (!parsed.success) {
        throw new SourceConfigurationError('usda', [
            ...new Set(parsed.error.issues.map((issue) => String(issue.path[0]))),
        ]);
    }

    const { USDA_API_KEY_SECRET_ID: apiKeySecretId, USDA_API_BASE_URL: baseUrl } = parsed.data;

    return {
        async search(term: string): Promise<SourceSearchOutcome> {
            const apiKey = await readSecret(apiKeySecretId);
            const upstream = recordingFetch(fetchFn);
            const client = new UsdaApiClient({
                apiKey,
                fetchFn: upstream.fetchFn,
                ...(baseUrl === undefined ? {} : { baseUrl }),
            });

            try {
                const result = await client.searchFoods(term);

                return {
                    kind: 'answered',
                    items: result.foods.map(usdaSearchCandidate),
                    passthroughHeaders: passthroughOf(upstream.headers()),
                };
            } catch (error) {
                return failureOf(error, passthroughOf(upstream.headers()));
            }
        },
    };
}
