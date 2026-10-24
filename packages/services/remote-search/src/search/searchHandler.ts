/**
 * One search, end to end: parse the request, refuse it or answer "not admitted" without touching a source, or ask the
 * source's adapter once and answer with what it said (ADR-0055 points 1, 2 and 6). One log line per request.
 *
 * The source adapter comes from the caller, so a source joins through the adapter register and nothing here changes.
 *
 * @pattern Facade — the request parser, the adapter register and the response builder behind one call
 * @module
 */
import type { SearchLogAttributes } from '../logging/searchLogAttributes.js';
import type { LogLevel, SearchLogger } from '../logging/searchLogger.js';
import type { RemoteSourceAdapter } from '../sources/remoteSourceAdapter.js';
import { isSourceConfigurationError } from '../sources/sourceConfigurationError.js';
import type { RemoteSearchSource } from './remoteSearch.schema.js';
import { parseSearchRequest, type SearchRequestInput } from './searchRequest.js';
import {
    INTERNAL_ERROR,
    outcomeBody,
    refusalBody,
    searchResponse,
    type SearchBody,
    type SearchResponse,
} from './searchResponse.js';

/** What the handler calls out to. */
export interface SearchDependencies {
    /**
     * Build a source's adapter.
     *
     * @throws {SourceConfigurationError} when the source's configuration is missing or malformed.
     */
    readonly adapterFor: (source: RemoteSearchSource) => RemoteSourceAdapter;
    readonly logger: SearchLogger;
}

/**
 * The log fields a body states. Pure.
 *
 * @param body - The body.
 * @returns Its outcome, or its code and the detail that names the cause.
 */
function bodyFields(body: SearchBody): SearchLogAttributes {
    if ('outcome' in body) {
        return { outcome: body.outcome };
    }

    switch (body.code) {
        case 'INVALID_REQUEST':
            return { code: body.code, parameter: body.details.parameter };
        case 'SOURCE_ERROR':
            return { code: body.code, sourceStatus: body.details.sourceStatus };
        default:
            return { code: body.code };
    }
}

/**
 * Answer with a body, and write the request's one log line.
 *
 * @param logger - The logger.
 * @param fields - The request's own log fields: its `rid` and source, when known.
 * @param body - The body.
 * @param response - The response that carries it.
 * @returns The response.
 * @sideEffect Writes one log line.
 */
function logged(
    logger: SearchLogger,
    fields: SearchLogAttributes,
    body: SearchBody,
    response: SearchResponse,
): SearchResponse {
    const level: LogLevel = response.statusCode >= 500 ? 'warn' : 'info';

    logger[level]('remote-search', { ...fields, status: response.statusCode, ...bodyFields(body) });

    return response;
}

/**
 * Handle one function URL request.
 *
 * @param event - The request.
 * @param dependencies - The adapter register and the logger.
 * @returns The response.
 * @sideEffect Calls the source at most once, only with `admit=1`; writes one log line.
 */
export async function handleSearchRequest(
    event: SearchRequestInput,
    dependencies: SearchDependencies,
): Promise<SearchResponse> {
    const { logger } = dependencies;
    const request = parseSearchRequest(event);

    if (request.kind === 'refused') {
        const body = refusalBody(request.refusal);

        return logged(
            logger,
            request.rid === undefined ? {} : { rid: request.rid },
            body,
            searchResponse(body, request.rid),
        );
    }

    const fields = { rid: request.rid, source: request.source };

    if (!request.admitted) {
        const body: SearchBody = { outcome: 'notAdmitted' };

        return logged(logger, fields, body, searchResponse(body, request.rid));
    }

    try {
        const outcome = await dependencies.adapterFor(request.source).search(request.term);
        const body = outcomeBody(outcome);

        return logged(logger, fields, body, searchResponse(body, request.rid, outcome.passthroughHeaders));
    } catch (error) {
        logger.error('remote-search-failed', {
            ...fields,
            status: 500,
            errorName: error instanceof Error ? error.name : typeof error,
            ...(isSourceConfigurationError(error) ? { variables: error.variables } : {}),
        });

        return searchResponse(INTERNAL_ERROR, request.rid);
    }
}
