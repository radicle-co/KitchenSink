/**
 * The function URL entry point (ADR-0055 point 8): no framework, no VPC, no database. Each request builds its source's
 * adapter from the process environment, so a configuration fault answers this service's own `INTERNAL` error, never
 * stored, instead of failing the function at start.
 *
 * A source's credential is read from Secrets Manager the first time an admitted search needs it, and kept for the
 * life of the container (`cachingSecretReader`). A failed read answers `INTERNAL` and is retried by the next request.
 *
 * @module
 */
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { LambdaFunctionURLEvent } from 'aws-lambda';

import { createSearchLogger } from './logging/searchLogger.js';
import { flushObservability, initObservability } from './observability/observability.js';
import { handleSearchRequest } from './search/searchHandler.js';
import type { SearchResponse } from './search/searchResponse.js';
import { cachingSecretReader } from './secrets/cachingSecretReader.js';
import { secretsManagerReader } from './secrets/secretsManagerAdapter.js';
import { SOURCE_ADAPTERS } from './sources/sourceAdapters.js';

// Inert without `SENTRY_DSN`, so a local run and every test behave as before.
initObservability(process.env);

const logger = createSearchLogger();

/** One per container: the client, and the cache that makes each credential one read per container. */
const readSecret = cachingSecretReader(secretsManagerReader(new SecretsManagerClient({})));

/**
 * Answer one search.
 *
 * @param event - The function URL request.
 * @returns The response.
 * @sideEffect Calls the source at most once, reading its credential at most once per container; writes one log line,
 *   and flushes Sentry before returning.
 */
export async function handler(event: LambdaFunctionURLEvent): Promise<SearchResponse> {
    const response = await handleSearchRequest(event, {
        adapterFor: (source) => SOURCE_ADAPTERS[source](process.env, { fetchFn: globalThis.fetch, readSecret }),
        logger,
    });

    await flushObservability();

    return response;
}
