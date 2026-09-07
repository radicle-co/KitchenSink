/**
 * THE DOCUMENT IS SELF-MAINTAINING, AND THIS IS WHAT MAINTAINS IT.
 *
 * §15 Rule 3 says a new endpoint is not complete until its types are reachable from the contract package.
 * A generated document cannot enforce that by itself: `buildRecipeOpenApiDocument` happily emits whatever
 * route table it is handed, so an endpoint added to a controller and forgotten in `contract/openapi.ts` is
 * INVISIBLE — the generator succeeds, CI stays green, and the published contract quietly stops describing
 * the API. That is the single most likely way this document rots.
 *
 * So the suite derives the route list from the CONTROLLERS' own Nest routing metadata (read off the classes;
 * no HTTP, no DB, no app boot) and requires it to match the document EXACTLY, in both directions:
 *
 *  - an undocumented route fails, which is the rot above;
 *  - a documented route the service does not serve also fails, which is the opposite rot — a path left in
 *    the spec after the handler was deleted, i.e. a document promising an endpoint that 404s.
 *
 * The second assertion class is the COVERAGE RATCHET. `RESPONSES_WITHOUT_SCHEMA` is the exact, recorded set of
 * response bodies the document does not describe — and it is now EMPTY: all 41 operations carry a response
 * schema. Pinning the set rather than a count means closing a gap and opening a new one cannot cancel out, and
 * every movement in either direction is a deliberate edit with a diff a reviewer can see. §15.2.5 records that
 * undocumented response bodies are most of what actually breaks a client, so with the set at zero the ratchet's
 * job changes from measuring progress to refusing regression.
 *
 * ── THE THIRD CLASS: THE REQUEST SIDE, WHICH WAS ENTIRELY UNGUARDED ──
 *
 * ⚠️ Every assertion above and every entry in the coverage report reads RESPONSES. This file contained no
 * mention of `parameters` or `requestBody`, so the whole request half of all 41 operations was unchecked — and
 * `buildRecipeOpenApiDocument` will happily emit an operation with a `{id}` in its path and no path parameter,
 * or a handler with an `@Body()` and no `requestBody`, or a bound looser than the one the service enforces.
 *
 * That was not a theoretical hole. `searchRecipes` published `pageSize` as `minimum: 1` with NO maximum while
 * the runtime rejected anything above 50, so the document was LOOSER than the service on the one bound the
 * response envelope's honesty depends on; its three int4 ceilings were hand-inlined and its five `sortBy`
 * members hand-copied out of the domain enum. All four were invisible here.
 *
 * So the request side is now asserted three ways, each derived from a DIFFERENT source so they cannot all be
 * satisfied by one wrong edit:
 *
 *  1. **Path templates ↔ path parameters** — from the document's own path strings. A `{param}` with no
 *     declared `in: path` parameter is an invalid document that an integrator's codegen rejects.
 *  2. **`@Body()` handlers ↔ `requestBody`** — from the CONTROLLERS' Nest parameter metadata, the same
 *     independent source the route-list assertion uses.
 *  3. **Documented bounds ↔ the authored zod** — for the query contract, field-name parity in both directions
 *     plus equality of every numeric bound and enum vocabulary.
 */
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
// `RouteParamtypes` is not re-exported from the package root — it is reached at its own subpath, which is where
// Nest's decorators read it from too.
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import { RequestMethod } from '@nestjs/common';
import { INT4_CEILING, MAX_SEARCH_PAGE_SIZE } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { AccountController } from '../../src/account/account.controller.js';
import { ServiceErasureController } from '../../src/account/serviceErasure.controller.js';
import { CollectionsController } from '../../src/collections/collections.controller.js';
import { HealthController } from '../../src/health/health.controller.js';
import { IngredientsController } from '../../src/ingredients/ingredients.controller.js';
import { PhotosController } from '../../src/photos/photos.controller.js';
import { ParseJobsController } from '../../src/recipes/parseJobs.controller.js';
import { RatingsController } from '../../src/ratings/ratings.controller.js';
import { RecipesController } from '../../src/recipes/recipes.controller.js';
import { SearchController } from '../../src/search/search.controller.js';
import { RECIPE_SEARCH_SORT_BY, recipeSearchQuerySchema } from '../../src/search/search.schema.js';
import { VersionsController } from '../../src/versions/versions.controller.js';
import { buildRecipeOpenApiDocument } from '../openapi.js';

/** Every controller the `AppModule` registers. */
const CONTROLLERS: readonly NewableFunction[] = [
    HealthController,
    RecipesController,
    ParseJobsController,
    RatingsController,
    VersionsController,
    PhotosController,
    IngredientsController,
    CollectionsController,
    SearchController,
    AccountController,
    ServiceErasureController,
];

/**
 * The response bodies the document deliberately does not describe, as `operationId statusCode`.
 *
 * ⚠️ IT IS NOW EMPTY, AND THAT IS THE WHOLE POINT — every one of the 41 operations carries a response schema.
 * The ratchet therefore no longer measures progress; it PREVENTS REGRESSION. An entry appearing here means a
 * new endpoint shipped without a described response body, which is exactly what §15.2.5 records as most of
 * what actually breaks a client, and it now cannot happen behind a green check: the assertion below is
 * `toEqual([])`, so the diff that adds an entry is a deliberate, reviewable edit.
 *
 * How it emptied, in order: the health probes came off when `contractHash` was added to their payload for
 * drift layer 3 (the moment a consumer reads a field off `/health`, that body IS wire contract); then search,
 * photos and ingredients; then the eight COLLECTIONS entries, with `collections.schema.ts`, which also settled
 * the four ways that contract had drifted; then the three ACCOUNT entries with `account.schema.ts`.
 *
 * Keep it as a pinned SET rather than a count: closing one gap and opening another must not cancel out.
 */
const RESPONSES_WITHOUT_SCHEMA: readonly string[] = [];

/** Nest's `RouteParamtypes.BODY` — the metadata key prefix a `@Body()` parameter leaves behind. */
const BODY_PARAMTYPE = RouteParamtypes.BODY;

/** Nest's `RequestMethod` enum → the lower-case verb OpenAPI uses. */
const VERB_BY_REQUEST_METHOD: Readonly<Record<number, string>> = {
    [RequestMethod.GET]: 'get',
    [RequestMethod.POST]: 'post',
    [RequestMethod.PUT]: 'put',
    [RequestMethod.DELETE]: 'delete',
    [RequestMethod.PATCH]: 'patch',
};

/** Read the route path(s) a `@Controller()` registered, always as an array. */
function controllerPaths(target: NewableFunction): readonly string[] {
    const metadata: unknown = Reflect.getMetadata(PATH_METADATA, target);

    return Array.isArray(metadata) ? (metadata as string[]) : [metadata as string];
}

/** Rewrite Nest's `:param` segments to OpenAPI's `{param}`, and normalize to a single leading slash. */
function toOpenApiPath(base: string, handlerPath: string): string {
    const segments = [base, handlerPath === '/' ? '' : handlerPath].filter((part) => part.length > 0).join('/');

    return `/${segments}`
        .replace(/\/+/gu, '/')
        .replace(/:([A-Za-z0-9_]+)/gu, '{$1}')
        .replace(/\/$/u, '');
}

/**
 * Enumerate `verb path` for every route a controller registers under its CANONICAL prefix.
 *
 * The deprecated bare `v1/...` alias is skipped on purpose — the document publishes only the canonical
 * spelling (see `contract/openapi.ts`), so including the alias here would demand 30 duplicate path entries
 * whose only effect would be to advertise the deprecated form.
 */
function routesOf(controller: NewableFunction): readonly string[] {
    const bases = controllerPaths(controller).filter((path) => path === 'health' || path.startsWith('api/'));
    const prototype = controller.prototype as object;
    const routes: string[] = [];

    for (const key of Object.getOwnPropertyNames(prototype)) {
        if (key === 'constructor') {
            continue;
        }

        const handler = (prototype as Record<string, unknown>)[key];

        if (typeof handler !== 'function') {
            continue;
        }

        const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);

        if (typeof method !== 'number') {
            continue;
        }

        const verb = VERB_BY_REQUEST_METHOD[method];
        const handlerPath: unknown = Reflect.getMetadata(PATH_METADATA, handler);

        expect(verb, `unhandled RequestMethod ${method} on ${controller.name}.${key}`).toBeDefined();

        for (const base of bases) {
            routes.push(`${verb as string} ${toOpenApiPath(base, String(handlerPath))}`);
        }
    }

    return routes;
}

/** Every `verb path` the service actually serves under its canonical prefix, sorted. */
const servedRoutes: readonly string[] = [...CONTROLLERS.flatMap(routesOf)].sort();

/** The emitted operation fields these assertions read. `security` is present only when declared. */
interface EmittedOperation {
    readonly operationId: string;
    readonly security?: readonly unknown[];
    readonly parameters?: readonly EmittedParameter[];
    readonly requestBody?: unknown;
}

/** One emitted parameter, as it appears in the document. */
interface EmittedParameter {
    readonly name: string;
    readonly in: string;
    readonly required: boolean;
    readonly schema: Record<string, unknown>;
}

/**
 * Every `verb path` whose handler declares an `@Body()`, read from the CONTROLLERS' Nest parameter metadata.
 *
 * The route-list assertion above derives from `PATH_METADATA`/`METHOD_METADATA`; this derives from
 * `ROUTE_ARGS_METADATA`, whose keys Nest encodes as `"<RouteParamtypes>:<index>"` — `RouteParamtypes.BODY` is
 * `3`. Reading the framework's own metadata rather than the source text is what makes this independent of the
 * document: a handler cannot take a body without leaving this trace.
 */
function bodyRoutesOf(controller: NewableFunction): readonly string[] {
    const bases = controllerPaths(controller).filter((path) => path === 'health' || path.startsWith('api/'));
    const prototype = controller.prototype as object;
    const routes: string[] = [];

    for (const key of Object.getOwnPropertyNames(prototype)) {
        if (key === 'constructor') {
            continue;
        }

        const handler = (prototype as Record<string, unknown>)[key];

        if (typeof handler !== 'function') {
            continue;
        }

        const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
        // ⚠️ Nest's `assignMetadata` defines `ROUTE_ARGS_METADATA` on `target.constructor` — the CLASS — keyed by
        // the method name, NOT on the prototype. Reading the prototype yields `undefined` for every handler, which
        // is a silently EMPTY result set: the parity assertions below would all pass against nothing. That is why
        // the non-vacuity case above asserts a floor on this list first (and it is how this bug was caught).
        const args: unknown = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, key);

        if (typeof method !== 'number' || args === null || typeof args !== 'object') {
            continue;
        }

        // A `@Body()` with no property argument reads the WHOLE body; `@Body('field')` also implies one. Both
        // are `RouteParamtypes.BODY`, so the prefix match covers each form.
        const takesBody = Object.keys(args).some((argKey) => argKey.startsWith(`${BODY_PARAMTYPE}:`));

        if (!takesBody) {
            continue;
        }

        const verb = VERB_BY_REQUEST_METHOD[method];
        const handlerPath: unknown = Reflect.getMetadata(PATH_METADATA, handler);

        for (const base of bases) {
            routes.push(`${verb as string} ${toOpenApiPath(base, String(handlerPath))}`);
        }
    }

    return routes;
}

const built = buildRecipeOpenApiDocument();
const document = built.document as {
    readonly paths: Readonly<Record<string, Readonly<Record<string, EmittedOperation>>>>;
    readonly components: { readonly schemas: Readonly<Record<string, unknown>> };
};

/** Every `verb path` the document declares, sorted. */
const documentedRoutes: readonly string[] = Object.entries(document.paths)
    .flatMap(([path, methods]) => Object.keys(methods).map((verb) => `${verb} ${path}`))
    .sort();

describe('the recipe OpenAPI document', () => {
    it('is not vacuous — the controllers really do register routes, so the comparison below has teeth', () => {
        expect(servedRoutes.length).toBeGreaterThan(30);
    });

    it('documents every route the controllers serve, and serves every route it documents', () => {
        expect(documentedRoutes).toEqual(servedRoutes);
    });

    it('publishes ONLY the canonical /api/v1 spelling, never the deprecated bare /v1 alias', () => {
        const barePaths = Object.keys(document.paths).filter((path) => path.startsWith('/v1/'));

        expect(barePaths).toEqual([]);
    });

    it('gives every operation a unique operationId, so an integrator’s codegen cannot collide', () => {
        const ids = Object.values(document.paths).flatMap((methods) =>
            Object.values(methods).map((operation) => operation.operationId),
        );

        expect([...new Set(ids)]).toHaveLength(ids.length);
    });

    it('resolves every $ref against a declared component', () => {
        const declared = new Set(Object.keys(document.components.schemas));
        const refs = [...JSON.stringify(document).matchAll(/"#\/components\/schemas\/([^"]+)"/gu)].map(
            (match) => match[1] as string,
        );

        expect(refs.length).toBeGreaterThan(0);
        expect([...new Set(refs)].filter((ref) => !declared.has(ref))).toEqual([]);
    });

    it('marks ONLY the health probes as unauthenticated', () => {
        const publicOperations = Object.values(document.paths).flatMap((methods) =>
            Object.values(methods)
                .filter((operation) => operation.security?.length === 0)
                .map((operation) => operation.operationId),
        );

        expect(publicOperations.sort()).toEqual(['getHealth', 'getReadiness']);
    });
});

// ── THE REQUEST SIDE ───────────────────────────────────────────────────────────────────────────────

/** Every `verb path` whose handler takes an `@Body()`, from the controllers' own metadata, sorted. */
const bodyRoutes: readonly string[] = [...CONTROLLERS.flatMap(bodyRoutesOf)].sort();

/** Every emitted operation, flattened with the `verb path` it was emitted under. */
const emittedOperations: readonly { readonly route: string; readonly operation: EmittedOperation }[] = Object.entries(
    document.paths,
).flatMap(([path, methods]) =>
    Object.entries(methods).map(([verb, operation]) => ({ route: `${verb} ${path}`, operation })),
);

describe('the request side of the document', () => {
    it('is not vacuous — handlers really do take bodies, and operations really do declare parameters', () => {
        expect(bodyRoutes.length).toBeGreaterThan(10);
        expect(emittedOperations.filter(({ operation }) => operation.parameters !== undefined).length).toBeGreaterThan(
            15,
        );
    });

    /*
     * (1) A `{param}` in the path with no `in: path` parameter beside it is an INVALID document — an integrator's
     * generator has no name, no type and no `required` for a segment it must fill. Derived from the document's own
     * path strings, so it needs no second list to stay in step with the route table.
     */
    it('declares a path parameter for every {template} segment it publishes', () => {
        const missing = emittedOperations.flatMap(({ route, operation }) => {
            const templated = [...route.matchAll(/\{([^}]+)\}/gu)].map((match) => match[1] as string);
            const declared = new Set(
                (operation.parameters ?? []).filter((parameter) => parameter.in === 'path').map(({ name }) => name),
            );

            return templated.filter((name) => !declared.has(name)).map((name) => `${route}: {${name}}`);
        });

        expect(missing).toEqual([]);
    });

    /*
     * The other direction: a declared path parameter that appears in no template is dead weight at best, and at
     * worst the residue of a renamed segment — which is how a document comes to describe a route shape the
     * service does not serve.
     */
    it('declares no path parameter that the path template does not contain', () => {
        const stray = emittedOperations.flatMap(({ route, operation }) =>
            (operation.parameters ?? [])
                .filter((parameter) => parameter.in === 'path' && !route.includes(`{${parameter.name}}`))
                .map((parameter) => `${route}: ${parameter.name}`),
        );

        expect(stray).toEqual([]);
    });

    it('marks every path parameter required, because a path segment cannot be omitted', () => {
        const optional = emittedOperations.flatMap(({ route, operation }) =>
            (operation.parameters ?? [])
                .filter((parameter) => parameter.in === 'path' && !parameter.required)
                .map((parameter) => `${route}: ${parameter.name}`),
        );

        expect(optional).toEqual([]);
    });

    /*
     * (2) `requestBody` ⇄ `@Body()`, each side derived from a different source: the document from the route
     * table, the handlers from `ROUTE_ARGS_METADATA`. A body-taking handler with no documented `requestBody` is
     * an endpoint an integrator cannot call.
     *
     * ONE ROUTE IS DELIBERATELY EXEMPT, measured rather than assumed: `cloneRecipe`'s body is
     * `z.strictObject({}).default({})` — a clone derives every field from the source, so there is nothing for a
     * caller to send and the route table correctly declares no `requestBody`. That is the exact case
     * `contract.test.ts` documents for `cloneRecipeRequestSchema`. (`cloneCollection` DOES publish one: its body
     * carries a real optional field.)
     *
     * Pinned as a SET rather than filtered away, so a second exemption cannot join without a visible diff.
     */
    it('documents a requestBody for every body-taking handler, bar the one field-less clone', () => {
        const documented = new Set(
            emittedOperations.filter(({ operation }) => operation.requestBody !== undefined).map(({ route }) => route),
        );
        const undocumented = bodyRoutes.filter((route) => !documented.has(route)).sort();

        expect(undocumented).toEqual(['post /api/v1/recipes/{id}/clone']);
    });

    it('documents no requestBody on an operation whose handler takes no body', () => {
        const bodyless = new Set(bodyRoutes);
        const spurious = emittedOperations
            .filter(({ route, operation }) => operation.requestBody !== undefined && !bodyless.has(route))
            .map(({ route }) => route);

        expect(spurious).toEqual([]);
    });

    /*
     * `required: false` is a legitimate authored choice — `pullFromSource` and `cloneCollection` accept a body
     * whose every field is optional, so an absent body is a valid call. What must not happen is a body being
     * marked optional by ACCIDENT, so the set is pinned rather than asserted empty.
     */
    it('marks a requestBody optional on exactly the two routes that accept an absent body', () => {
        const optional = emittedOperations
            .filter(
                ({ operation }) =>
                    operation.requestBody !== undefined &&
                    (operation.requestBody as { required?: boolean }).required !== true,
            )
            .map(({ route }) => route)
            .sort();

        expect(optional).toEqual([
            'post /api/v1/collections/{id}/clone',
            'post /api/v1/collections/{id}/pull-from-source',
        ]);
    });
});

/*
 * (3) THE DOCUMENTED QUERY vs THE AUTHORED ZOD — the assertion whose absence let `pageSize` publish no maximum.
 *
 * These are two artifacts on purpose, not one derived from the other: `recipeSearchQuerySchema`'s INPUT type
 * accepts a list filter as either repeated params or one CSV value, which no single `in: query` parameter can
 * express, so the document must state the wire form itself. What must never diverge is the FIELD SET and the
 * BOUNDS — so those are asserted, in both directions, against the real schema object.
 */
describe('searchRecipes’ published parameters agree with the authored query schema', () => {
    const operation = emittedOperations.find(({ operation: candidate }) => candidate.operationId === 'searchRecipes');
    const parameters: readonly EmittedParameter[] = operation?.operation.parameters ?? [];
    const byName = new Map(parameters.map((parameter) => [parameter.name, parameter]));

    it('found the operation and its parameters, so the assertions below are not vacuous', () => {
        expect(operation).toBeDefined();
        expect(parameters.length).toBeGreaterThan(0);
        expect(parameters.every((parameter) => parameter.in === 'query')).toBe(true);
    });

    it('publishes EXACTLY the fields the schema parses — no undocumented filter, no documented phantom', () => {
        expect([...byName.keys()].sort()).toEqual(Object.keys(recipeSearchQuerySchema.shape).sort());
    });

    it('marks every search parameter optional, because a bare search is a browse', () => {
        expect(parameters.filter((parameter) => parameter.required).map(({ name }) => name)).toEqual([]);
    });

    /*
     * ⚠️ THE REGRESSION THIS FILE EXISTED WITHOUT. The document said `minimum: 1` and no maximum while the
     * runtime rejected above 50, so a client generated from the contract would build a request the service
     * refuses — and the response envelope echoes the REQUESTED page size, so an accepted 999 would have reported
     * `pageSize: 999` beside 50 rows.
     */
    it('publishes the page-size CEILING the runtime enforces', () => {
        expect(byName.get('pageSize')?.schema['maximum']).toBe(MAX_SEARCH_PAGE_SIZE);
        expect(recipeSearchQuerySchema.safeParse({ pageSize: String(MAX_SEARCH_PAGE_SIZE + 1) }).success).toBe(false);
    });

    it('publishes the int4 ceiling on each time filter, so an out-of-range filter is a 400 and not a 500', () => {
        for (const name of ['maxPrepTime', 'maxCookTime', 'maxTotalTime']) {
            expect(byName.get(name)?.schema['maximum'], `${name} publishes no int4 ceiling`).toBe(INT4_CEILING);
            expect(recipeSearchQuerySchema.safeParse({ [name]: String(INT4_CEILING + 1) }).success).toBe(false);
        }
    });

    /*
     * The sort vocabulary is one list (`RecipeSearchSortBy`, a `recipe-core` value object) reached two ways: the
     * schema enumerates it, the document publishes it. Both directions are asserted against the RUNTIME parse
     * rather than against each other's text, so adding a sort to the domain enum and forgetting either side fails.
     */
    it('publishes the same sort vocabulary the schema accepts, in both directions', () => {
        const published = byName.get('sortBy')?.schema['enum'] as readonly string[] | undefined;

        expect(published).toEqual([...RECIPE_SEARCH_SORT_BY]);

        for (const sortBy of published ?? []) {
            expect(recipeSearchQuerySchema.safeParse({ sortBy }).success, `${sortBy} is published but rejected`).toBe(
                true,
            );
        }

        expect(recipeSearchQuerySchema.safeParse({ sortBy: 'not-a-sort' }).success).toBe(false);
    });
});

describe('the coverage ratchet', () => {
    it('has exactly the recorded set of undescribed response bodies', () => {
        expect(built.coverage.responsesWithoutSchema).toEqual([...RESPONSES_WITHOUT_SCHEMA].sort());
    });

    it('reports a coverage figure consistent with that set — now EVERY operation is fully typed', () => {
        expect(built.coverage.totalOperations).toBe(servedRoutes.length);
        // Was `toBeLessThan` while gaps remained. It is `toBe` now, deliberately: with the set above empty,
        // `toBeLessThan` would have become an assertion that the document is INCOMPLETE, and would have
        // started failing the moment the last gap closed. Equality is the property worth holding from here.
        expect(built.coverage.operationsFullyTyped).toBe(built.coverage.totalOperations);
        expect(built.coverage.componentCount).toBe(Object.keys(document.components.schemas).length);
    });

    it('describes a response body for EVERY operation the service serves, with none left undescribed', () => {
        // The same property as the empty set above, asserted from the document rather than the report — so a
        // bug in the generator's own coverage accounting cannot make the ratchet look closed while it is not.
        const undescribed = Object.entries(document.paths).flatMap(([path, methods]) =>
            Object.entries(methods).flatMap(([verb, operation]) =>
                Object.entries((operation as unknown as { readonly responses: Record<string, unknown> }).responses)
                    .filter(([status, response]) => {
                        const hasSchema = (response as { readonly content?: unknown }).content !== undefined;

                        return !hasSchema && status !== '204' && status !== '304';
                    })
                    .map(([status]) => `${verb} ${path} ${status}`),
            ),
        );

        expect(undescribed).toEqual([]);
    });
});
