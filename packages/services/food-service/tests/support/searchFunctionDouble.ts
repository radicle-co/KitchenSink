/**
 * A double of the remote search function (`packages/services/remote-search`) that keeps its published contract
 * (`@kitchensink/schema-remote-search`): a miss asked with `admit=0` is a `200` `notAdmitted` outcome (`s-maxage` 1 second)
 * and calls no source; `admit=1` calls
 * the source once and answers found (`s-maxage` 7 days) or empty (1 day); a path that names no search it serves is
 * `404 NOT_FOUND`; every other answer is `no-store`; every response echoes the request's `rid`; the source's quota
 * headers and `Retry-After` pass through. It records each source call, so "the source was not called" is an assertion
 * on what reached the source.
 *
 * ⚠️ A double, not the real handler: food cannot import the search service's handler until that package declares an
 * entry point for it. It proves food's side of the protocol only.
 *
 * @pattern Fake — a working implementation of the search function's contract
 */
import {
    REMOTE_SEARCH_NOT_ADMITTED_MAX_AGE_SECONDS,
    REMOTE_SEARCH_NOT_ADMITTED_STATUS,
    REMOTE_SEARCH_RID_HEADER,
    REMOTE_SEARCH_SOURCE_FAILURE_STATUS,
    remoteSearchPath,
    remoteSearchQuerySchema,
    remoteSearchSourceSchema,
    type RemoteSearchItem,
} from '@kitchensink/schema-remote-search';

import { isCanonicalSearchTerm } from '../../src/foods/foods.schema.js';
import type { OriginEvent, OriginResult, SearchOrigin } from './searchEdgeStandIn.js';

/** How the double's source answers the next admitted call. */
export type SourceMode =
    | { readonly kind: 'found'; readonly items: readonly RemoteSearchItem[] }
    | { readonly kind: 'empty' }
    /** The source answered this status (a 429 or an outage). */
    | { readonly kind: 'sourceStatus'; readonly status: number }
    /** The function URL's own throttle: a 429 the function never produced, so it carries no echo. */
    | { readonly kind: 'functionThrottled' };

/** A running double. */
export interface SearchFunctionDouble {
    /** The function, to put behind the edge stand-in. */
    readonly origin: SearchOrigin;
    /** How the source answers; a suite sets it per case. */
    mode: SourceMode;
    /**
     * The function serves another adapter revision than the one food asks for, so food's path names no search it
     * serves (ADR-0055 point 8).
     */
    servesAnotherRevision: boolean;
    /** The quota headers the source sends with every answer, or none. */
    quota: Readonly<Record<string, string>>;
    /** The `Retry-After` the source sends, or none. */
    retryAfter: string | undefined;
    /** The term of every call that reached the source, in order. */
    readonly sourceCalls: string[];
    /** Every request id the function received, in order. */
    readonly rids: string[];
}

/**
 * A result echoing `rid`.
 *
 * @param statusCode - The status.
 * @param rid - The request id.
 * @param body - The body.
 * @param headers - Any other headers.
 * @returns The result.
 */
function resultOf(
    statusCode: number,
    rid: string,
    body: unknown,
    headers: Readonly<Record<string, string>> = { 'cache-control': 'no-store' },
): OriginResult {
    return {
        statusCode,
        headers: { 'content-type': 'application/json', ...headers, [REMOTE_SEARCH_RID_HEADER]: rid },
        body: JSON.stringify(body),
    };
}

/**
 * Start a double whose source answers found with no items until told otherwise.
 *
 * @returns The double.
 */
export function searchFunctionDouble(): SearchFunctionDouble {
    const sourceCalls: string[] = [];
    const rids: string[] = [];
    const sources = new Map(remoteSearchSourceSchema.options.map((source) => [remoteSearchPath(source), source]));

    const handle = async (event: OriginEvent): Promise<OriginResult> => {
        const params = new URLSearchParams(event.rawQueryString);
        const rid = remoteSearchQuerySchema.shape.rid.safeParse(params.get('rid'));

        if (!rid.success) {
            return { statusCode: 400, headers: { 'cache-control': 'no-store' }, body: '{}' };
        }

        rids.push(rid.data);

        if (!sources.has(event.rawPath) || double.servesAnotherRevision) {
            return resultOf(404, rid.data, { code: 'NOT_FOUND', message: 'No search at this path.' });
        }

        const term = params.get('q') ?? '';

        if (!isCanonicalSearchTerm(term)) {
            return resultOf(400, rid.data, {
                code: 'INVALID_REQUEST',
                message: 'refused',
                details: { parameter: 'q' },
            });
        }

        if (params.get('admit') !== '1') {
            return resultOf(
                REMOTE_SEARCH_NOT_ADMITTED_STATUS,
                rid.data,
                { outcome: 'notAdmitted' },
                {
                    'cache-control': `public, s-maxage=${String(REMOTE_SEARCH_NOT_ADMITTED_MAX_AGE_SECONDS)}`,
                },
            );
        }

        if (double.mode.kind === 'functionThrottled') {
            return {
                statusCode: 429,
                headers: { 'content-type': 'application/json' },
                body: '{"message":"Rate exceeded"}',
            };
        }

        sourceCalls.push(term);

        const passthrough = {
            ...double.quota,
            ...(double.retryAfter === undefined ? {} : { 'Retry-After': double.retryAfter }),
        };

        switch (double.mode.kind) {
            case 'found':
                return resultOf(
                    200,
                    rid.data,
                    { outcome: 'found', items: double.mode.items },
                    { ...passthrough, 'cache-control': 'public, s-maxage=604800' },
                );
            case 'empty':
                return resultOf(
                    200,
                    rid.data,
                    { outcome: 'empty' },
                    { ...passthrough, 'cache-control': 'public, s-maxage=86400' },
                );
            case 'sourceStatus':
                return resultOf(
                    REMOTE_SEARCH_SOURCE_FAILURE_STATUS,
                    rid.data,
                    {
                        code: 'SOURCE_ERROR',
                        message: `The source answered ${String(double.mode.status)}.`,
                        details: { sourceStatus: double.mode.status },
                    },
                    { ...passthrough, 'cache-control': 'no-store' },
                );
        }
    };

    const double: SearchFunctionDouble = {
        origin: handle,
        mode: { kind: 'found', items: [] },
        servesAnotherRevision: false,
        quota: {},
        retryAfter: undefined,
        sourceCalls,
        rids,
    };

    return double;
}
