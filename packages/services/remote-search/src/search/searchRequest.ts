/**
 * A function URL request, parsed into a typed search or a typed refusal (ADR-0055 points 2 and 6).
 *
 * `rid` is read first, so every later refusal can echo it. The query string is read with `URLSearchParams`, which keeps
 * a repeated parameter as two values; a repeated `q`, `admit` or `rid` is refused rather than picked from. A parameter
 * this service does not read is ignored, because the answer depends on `q`, `admit` and `rid` alone.
 *
 * @pattern Parser — an untrusted event in, a discriminated union out
 * @module
 */
import { isCanonicalSearchTerm } from '@kitchensink/schema-food';

import {
    remoteSearchPath,
    remoteSearchQuerySchema,
    remoteSearchSourceSchema,
    type RemoteSearchParameter,
    type RemoteSearchSource,
} from './remoteSearch.schema.js';

/** The part of a function URL event the parser reads. A `LambdaFunctionURLEvent` satisfies it. */
export interface SearchRequestInput {
    readonly rawPath: string;
    readonly rawQueryString: string;
    readonly requestContext: { readonly http: { readonly method: string } };
}

/** Why a request is refused before any source is asked. */
export type RequestRefusal =
    | { readonly reason: 'invalidParameter'; readonly parameter: RemoteSearchParameter }
    | { readonly reason: 'notFound' }
    | { readonly reason: 'methodNotAllowed' };

/** A parsed request. */
export type SearchRequest =
    | {
          readonly kind: 'search';
          readonly rid: string;
          readonly source: RemoteSearchSource;
          /** The canonical term. */
          readonly term: string;
          /** Whether the source may be called on a miss (`admit=1`). */
          readonly admitted: boolean;
      }
    | {
          readonly kind: 'refused';
          /** The request's `rid`, or `undefined` when it did not parse. */
          readonly rid: string | undefined;
          readonly refusal: RequestRefusal;
      };

/** Each source's search path, from the contract's own path builder. */
const SOURCE_OF_PATH: ReadonlyMap<string, RemoteSearchSource> = new Map(
    remoteSearchSourceSchema.options.map((source) => [remoteSearchPath(source), source]),
);

/**
 * A parameter's one value. Pure.
 *
 * @param params - The query.
 * @param name - The parameter.
 * @returns Its value, or `undefined` when it is absent or repeated.
 */
function single(params: URLSearchParams, name: RemoteSearchParameter): string | undefined {
    const values = params.getAll(name);

    return values.length === 1 ? values[0] : undefined;
}

/**
 * Parse a function URL request. Pure.
 *
 * @param event - The request.
 * @returns The search, or the refusal that answers it.
 */
export function parseSearchRequest(event: SearchRequestInput): SearchRequest {
    const params = new URLSearchParams(event.rawQueryString);
    const rid = remoteSearchQuerySchema.shape.rid.safeParse(single(params, 'rid'));

    if (!rid.success) {
        return { kind: 'refused', rid: undefined, refusal: { reason: 'invalidParameter', parameter: 'rid' } };
    }

    const refused = (refusal: RequestRefusal): SearchRequest => ({ kind: 'refused', rid: rid.data, refusal });

    if (event.requestContext.http.method !== 'GET') {
        return refused({ reason: 'methodNotAllowed' });
    }

    const source = SOURCE_OF_PATH.get(event.rawPath);

    if (source === undefined) {
        return refused({ reason: 'notFound' });
    }

    const term = single(params, 'q');

    if (term === undefined || !isCanonicalSearchTerm(term)) {
        return refused({ reason: 'invalidParameter', parameter: 'q' });
    }

    const admit = remoteSearchQuerySchema.shape.admit.safeParse(single(params, 'admit'));

    if (!admit.success) {
        return refused({ reason: 'invalidParameter', parameter: 'admit' });
    }

    return { kind: 'search', rid: rid.data, source, term, admitted: admit.data === '1' };
}
