/**
 * THE REMOTE SEARCH SERVICE's OpenAPI DOCUMENT — declared from the authored zod, for external consumption. It is not a
 * code-generation input and not the type authority (§15.2.1): that is the zod `@kitchensink/schema-remote-search`
 * exports.
 *
 * ADDING A SOURCE changes no path here: `{source}` and `{adapterRevision}` are parameters, and the source enum is the
 * contract's own.
 */
import { buildOpenApiDocument } from '@kitchensink/contract-gen';
import type { OpenApiBuildResult, OpenApiResponse } from '@kitchensink/contract-gen';
import { USDA_QUOTA_HEADERS } from '@kitchensink/usda-client';
import { z } from 'zod';

import {
    REMOTE_SEARCH_CONTRACT_MAJOR,
    REMOTE_SEARCH_NOT_ADMITTED_STATUS,
    REMOTE_SEARCH_RID_HEADER,
    REMOTE_SEARCH_SOURCE_FAILURE_STATUS,
    remoteSearchAnswerSchema,
    remoteSearchEmptySchema,
    remoteSearchErrorSchema,
    remoteSearchFoundSchema,
    remoteSearchItemSchema,
    remoteSearchNotAdmittedSchema,
    remoteSearchQuerySchema,
    remoteSearchSourceSchema,
} from '../src/search/remoteSearch.schema.js';

/** The named component schemas, keyed by the name the document publishes them under. */
export const openApiComponents = {
    RemoteSearchItem: remoteSearchItemSchema,
    RemoteSearchFound: remoteSearchFoundSchema,
    RemoteSearchEmpty: remoteSearchEmptySchema,
    RemoteSearchAnswer: remoteSearchAnswerSchema,
    RemoteSearchNotAdmitted: remoteSearchNotAdmittedSchema,
    RemoteSearchError: remoteSearchErrorSchema,
} as const;

type ComponentName = keyof typeof openApiComponents;

/** The echo of the request's `rid`. */
const ridHeader = {
    [REMOTE_SEARCH_RID_HEADER]: {
        description:
            "The request's `rid`, on every response to a request whose `rid` parsed. A cached answer echoes the request that stored it (ADR-0055 point 6).",
        schema: remoteSearchQuerySchema.shape.rid,
    },
} as const;

/** The source's own quota count and block signal, passed on verbatim when the source sent them. */
const sourceHeaders = {
    [USDA_QUOTA_HEADERS.limitHeader]: {
        description: "USDA's quota size for the API key, verbatim, when USDA sent it.",
        schema: z.string(),
    },
    [USDA_QUOTA_HEADERS.remainingHeader]: {
        description: "USDA's calls left for the API key, verbatim, when USDA sent it.",
        schema: z.string(),
    },
    'Retry-After': { description: "The source's own `Retry-After`, verbatim, when it sent one.", schema: z.string() },
} as const;

/**
 * A response with its `Cache-Control`.
 *
 * @param description - What the status means.
 * @param schema - The body's component.
 * @param cacheControl - The `Cache-Control` value it carries.
 * @param fromSource - Whether the source's headers may be passed on.
 * @returns The response.
 */
function response(
    description: string,
    schema: ComponentName,
    cacheControl: string,
    fromSource: boolean,
): OpenApiResponse<ComponentName> {
    return {
        description,
        schema,
        headers: {
            'Cache-Control': { description: `\`${cacheControl}\`.`, schema: z.string() },
            ...ridHeader,
            ...(fromSource ? sourceHeaders : {}),
        },
    };
}

/** The derived document plus its response-schema coverage report. */
export const remoteSearchOpenApiDocument: OpenApiBuildResult = buildOpenApiDocument({
    title: 'Commise Remote Food Search',
    version: `${String(REMOTE_SEARCH_CONTRACT_MAJOR)}.0.0`,
    description:
        "Searches a remote food source for food-service, behind a CloudFront cache (ADR-0055). The apps never call it. Only food-service's signed URLs reach it, through the distribution's origin access control. Only a `200` may be cached: a found answer for 7 days, an empty one for 1 day; every other response is `no-store`.",
    servers: [],
    securitySchemes: {
        cloudFrontSignedUrl: {
            type: 'apiKey',
            in: 'query',
            name: 'Signature',
            description:
                'A CloudFront signed URL (ADR-0055 point 7). `admit` and `rid` are signed, forwarded, and kept out of the cache key.',
        },
    },
    defaultSecurity: ['cloudFrontSignedUrl'],
    components: openApiComponents,
    paths: {
        [`/v${String(REMOTE_SEARCH_CONTRACT_MAJOR)}/{source}/{adapterRevision}/search`]: {
            get: {
                operationId: 'searchRemoteSource',
                summary: 'Search one remote source',
                description:
                    'Answers from the cache when it can. On a miss with `admit=0` it answers `notAdmitted` and does not call the source; with `admit=1` it calls the source once, never retrying.',
                parameters: [
                    {
                        name: 'source',
                        in: 'path',
                        required: true,
                        description: 'The source.',
                        schema: remoteSearchSourceSchema,
                    },
                    {
                        name: 'adapterRevision',
                        in: 'path',
                        required: true,
                        description:
                            "The source adapter's current revision. Any other revision is a `404`, so a cached answer is never read after its adapter changes.",
                        schema: z.int().positive(),
                    },
                    {
                        name: 'q',
                        in: 'query',
                        required: true,
                        description:
                            "The term, in the canonical form food-service's `searchTermQuerySchema` (`@kitchensink/schema-food`) produces. Any other term is a `400`.",
                        schema: remoteSearchQuerySchema.shape.q,
                    },
                    {
                        name: 'admit',
                        in: 'query',
                        required: true,
                        description: '`1` lets the service call the source on a miss.',
                        schema: remoteSearchQuerySchema.shape.admit,
                    },
                    {
                        name: 'rid',
                        in: 'query',
                        required: true,
                        description: "The caller's request id, echoed on every response.",
                        schema: remoteSearchQuerySchema.shape.rid,
                    },
                ],
                responses: {
                    '200': response(
                        'What the source said: `found` (`public, s-maxage=604800`) or `empty` (`public, s-maxage=86400`).',
                        'RemoteSearchAnswer',
                        'public, s-maxage=604800 or public, s-maxage=86400',
                        true,
                    ),
                    '400': response(
                        'A parameter is missing, repeated or malformed.',
                        'RemoteSearchError',
                        'no-store',
                        false,
                    ),
                    '404': response(
                        'No search at this path: another major, source or adapter revision.',
                        'RemoteSearchError',
                        'no-store',
                        false,
                    ),
                    '405': response('Not a `GET`.', 'RemoteSearchError', 'no-store', false),
                    [String(REMOTE_SEARCH_NOT_ADMITTED_STATUS)]: response(
                        'A miss asked with `admit=0`. The source was not called.',
                        'RemoteSearchNotAdmitted',
                        'no-store',
                        false,
                    ),
                    '500': response('This service failed.', 'RemoteSearchError', 'no-store', false),
                    [String(REMOTE_SEARCH_SOURCE_FAILURE_STATUS)]: response(
                        'The source answered with a failure status (`SOURCE_ERROR`, with `sourceStatus`) or a body it does not publish (`SOURCE_INVALID_RESPONSE`).',
                        'RemoteSearchError',
                        'no-store',
                        true,
                    ),
                    '504': response(
                        'The source did not answer in time (`SOURCE_TIMEOUT`).',
                        'RemoteSearchError',
                        'no-store',
                        true,
                    ),
                },
            },
        },
    },
});
