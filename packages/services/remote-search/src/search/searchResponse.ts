/**
 * The function URL responses: a contract body, its status, and the headers a cache and the caller read (ADR-0055
 * points 2 and 6). Only `found` and `empty` may be shared, for 7 days and 1 day; every other response is `no-store`.
 * Every response to a request whose `rid` parsed echoes it.
 *
 * @module
 */
import type { PassthroughHeaders, SourceSearchOutcome } from '../sources/remoteSourceAdapter.js';
import {
    REMOTE_SEARCH_NOT_ADMITTED_STATUS,
    REMOTE_SEARCH_RID_HEADER,
    REMOTE_SEARCH_SOURCE_FAILURE_STATUS,
    type RemoteSearchAnswer,
    type RemoteSearchError,
    type RemoteSearchNotAdmitted,
} from './remoteSearch.schema.js';
import type { RequestRefusal } from './searchRequest.js';

/** A found answer is shared for 7 days. */
const FOUND_CACHE_CONTROL = 'public, s-maxage=604800';

/** An empty answer is shared for 1 day. */
const EMPTY_CACHE_CONTROL = 'public, s-maxage=86400';

/** Every other response is never stored. */
const NO_STORE = 'no-store';

/** Any body the service answers with. */
export type SearchBody = RemoteSearchAnswer | RemoteSearchNotAdmitted | RemoteSearchError;

/** A function URL response. A `LambdaFunctionURLResult` accepts it. */
export interface SearchResponse {
    readonly statusCode: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
}

/** The body this service answers with when it fails itself. */
export const INTERNAL_ERROR: RemoteSearchError = { code: 'INTERNAL', message: 'The search failed.' };

/**
 * The status and `Cache-Control` of a body. Pure.
 *
 * @param body - The body.
 * @returns Both.
 */
function dispositionOf(body: SearchBody): { readonly status: number; readonly cacheControl: string } {
    if ('outcome' in body) {
        switch (body.outcome) {
            case 'found':
                return { status: 200, cacheControl: FOUND_CACHE_CONTROL };
            case 'empty':
                return { status: 200, cacheControl: EMPTY_CACHE_CONTROL };
            case 'notAdmitted':
                return { status: REMOTE_SEARCH_NOT_ADMITTED_STATUS, cacheControl: NO_STORE };
        }
    }

    switch (body.code) {
        case 'INVALID_REQUEST':
            return { status: 400, cacheControl: NO_STORE };
        case 'NOT_FOUND':
            return { status: 404, cacheControl: NO_STORE };
        case 'METHOD_NOT_ALLOWED':
            return { status: 405, cacheControl: NO_STORE };
        case 'SOURCE_ERROR':
        case 'SOURCE_INVALID_RESPONSE':
            return { status: REMOTE_SEARCH_SOURCE_FAILURE_STATUS, cacheControl: NO_STORE };
        case 'SOURCE_TIMEOUT':
            return { status: 504, cacheControl: NO_STORE };
        case 'INTERNAL':
            return { status: 500, cacheControl: NO_STORE };
    }
}

/**
 * The response that carries a body. Pure.
 *
 * @param body - The body.
 * @param rid - The request id to echo, or `undefined` when it did not parse.
 * @param passthroughHeaders - The source's headers to pass on.
 * @returns The response.
 */
export function searchResponse(
    body: SearchBody,
    rid: string | undefined,
    passthroughHeaders: PassthroughHeaders = {},
): SearchResponse {
    const { status, cacheControl } = dispositionOf(body);

    return {
        statusCode: status,
        headers: {
            ...passthroughHeaders,
            ...('code' in body && body.code === 'METHOD_NOT_ALLOWED' ? { allow: 'GET' } : {}),
            'content-type': 'application/json',
            'cache-control': cacheControl,
            ...(rid === undefined ? {} : { [REMOTE_SEARCH_RID_HEADER]: rid }),
        },
        body: JSON.stringify(body),
    };
}

/**
 * The body a refused request answers with. Pure.
 *
 * @param refusal - Why the request was refused.
 * @returns The body.
 */
export function refusalBody(refusal: RequestRefusal): RemoteSearchError {
    switch (refusal.reason) {
        case 'invalidParameter':
            return {
                code: 'INVALID_REQUEST',
                message: `The ${refusal.parameter} parameter is missing, repeated or malformed.`,
                details: { parameter: refusal.parameter },
            };
        case 'notFound':
            return { code: 'NOT_FOUND', message: 'No search at this path.' };
        case 'methodNotAllowed':
            return { code: 'METHOD_NOT_ALLOWED', message: 'Only GET is served.' };
    }
}

/**
 * The body a source's outcome answers with. Pure.
 *
 * @param outcome - How the source search ended.
 * @returns The body.
 */
export function outcomeBody(outcome: SourceSearchOutcome): SearchBody {
    switch (outcome.kind) {
        case 'answered':
            return outcome.items.length === 0 ? { outcome: 'empty' } : { outcome: 'found', items: [...outcome.items] };
        case 'sourceStatus':
            return {
                code: 'SOURCE_ERROR',
                message: `The source answered ${String(outcome.sourceStatus)}.`,
                details: { sourceStatus: outcome.sourceStatus },
            };
        case 'invalidResponse':
            return {
                code: 'SOURCE_INVALID_RESPONSE',
                message: 'The source answered with a body this service cannot read.',
            };
        case 'timeout':
            return { code: 'SOURCE_TIMEOUT', message: 'The source did not answer in time.' };
    }
}
