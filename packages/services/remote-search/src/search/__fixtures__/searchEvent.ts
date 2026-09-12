/**
 * Function URL events for the search handler's tests: payload format 2.0, as a function URL delivers it.
 */
import type { LambdaFunctionURLEvent } from 'aws-lambda';

import { remoteSearchPath } from '../remoteSearch.schema.js';

/** A request id the contract admits (a ULID). */
export const VALID_RID = '01J9ZK8N7QF3B2X4M6T0V5C1AB';

/** A query value: one value, a repeated parameter, or absent. */
type QueryValue = string | readonly string[] | undefined;

/** What a test may change about the event. */
export interface SearchEventOptions {
    /** Merged over `q=chicken breast&admit=1&rid=VALID_RID`; `undefined` removes a parameter. */
    readonly query: Readonly<Record<string, QueryValue>>;
    /** Replaces the query string built from {@link SearchEventOptions.query} verbatim. */
    readonly rawQueryString: string;
    readonly rawPath: string;
    readonly method: string;
}

/**
 * A query string from parameter values, in the order given. Pure.
 *
 * @param query - The parameters.
 * @returns The encoded query string.
 */
function queryString(query: Readonly<Record<string, QueryValue>>): string {
    const params = new URLSearchParams();

    for (const [name, value] of Object.entries(query)) {
        for (const each of typeof value === 'string' ? [value] : (value ?? [])) {
            params.append(name, each);
        }
    }

    return params.toString();
}

/**
 * A function URL event for a search.
 *
 * @param options - What to change from a canonical, admitted USDA search.
 * @returns The event.
 */
export function makeSearchEvent(options: Partial<SearchEventOptions> = {}): LambdaFunctionURLEvent {
    const rawPath = options.rawPath ?? remoteSearchPath('usda');
    const method = options.method ?? 'GET';
    const rawQueryString =
        options.rawQueryString ??
        queryString({ q: 'chicken breast', admit: '1', rid: VALID_RID, ...(options.query ?? {}) });

    return {
        version: '2.0',
        routeKey: '$default',
        rawPath,
        rawQueryString,
        headers: { host: 'example.lambda-url.us-east-1.on.aws' },
        isBase64Encoded: false,
        requestContext: {
            accountId: 'anonymous',
            apiId: 'example',
            domainName: 'example.lambda-url.us-east-1.on.aws',
            domainPrefix: 'example',
            http: {
                method,
                path: rawPath,
                protocol: 'HTTP/1.1',
                sourceIp: '127.0.0.1',
                userAgent: 'Amazon CloudFront',
            },
            requestId: 'request-id',
            routeKey: '$default',
            stage: '$default',
            time: '02/Oct/2026:20:00:00 +0000',
            timeEpoch: 1_790_000_000_000,
        },
    };
}
