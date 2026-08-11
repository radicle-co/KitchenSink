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
 * The second assertion class is the COVERAGE RATCHET. `RESPONSES_WITHOUT_SCHEMA` is the exact, recorded set
 * of response bodies the document does not describe. Pinning the set rather than a count means closing a gap
 * and opening a new one cannot cancel out, and every movement in either direction is a deliberate edit with
 * a diff a reviewer can see. §15.2.5 records that undocumented response bodies are most of what actually
 * breaks a client, so this number is the one worth making hard to grow.
 */
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { AccountController } from '../../src/account/account.controller.js';
import { ServiceErasureController } from '../../src/account/service-erasure.controller.js';
import { CollectionsController } from '../../src/collections/collections.controller.js';
import { HealthController } from '../../src/health/health.controller.js';
import { IngredientsController } from '../../src/ingredients/ingredients.controller.js';
import { PhotosController } from '../../src/photos/photos.controller.js';
import { RatingsController } from '../../src/ratings/ratings.controller.js';
import { RecipesController } from '../../src/recipes/recipes.controller.js';
import { SearchController } from '../../src/search/search.controller.js';
import { VersionsController } from '../../src/versions/versions.controller.js';
import { buildRecipeOpenApiDocument } from '../openapi.js';

/** Every controller the `AppModule` registers. */
const CONTROLLERS: readonly NewableFunction[] = [
    HealthController,
    RecipesController,
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
 * The response bodies the document deliberately does not describe yet, as `operationId statusCode`.
 *
 * Each entry is a boundary with no authored zod on either side. Removing one is the goal; ADDING one means a
 * new endpoint shipped without a described response body, and that needs saying out loud in a PR rather than
 * slipping in behind a green check.
 *
 * The health probes USED to be here. They came off when `contractHash` was added to their payload for drift
 * layer 3: the moment a consumer is expected to read a field off `/health`, that body IS wire contract, so it
 * got an authored `health.schema.ts` like everything else.
 */
const RESPONSES_WITHOUT_SCHEMA: readonly string[] = [
    'addRecipeToCollection 201',
    'cloneCollection 201',
    'createCollection 201',
    'exportAccount 200',
    'getCollectionById 200',
    'listCollections 200',
    'previewPullFromSource 200',
    'pullCollectionFromSource 200',
    'requestAccountErasure 202',
    'requestServiceErasure 202',
    'updateCollection 200',
];

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

describe('the coverage ratchet', () => {
    it('has exactly the recorded set of undescribed response bodies', () => {
        expect(built.coverage.responsesWithoutSchema).toEqual([...RESPONSES_WITHOUT_SCHEMA].sort());
    });

    it('reports a coverage figure consistent with that set', () => {
        expect(built.coverage.totalOperations).toBe(servedRoutes.length);
        expect(built.coverage.operationsFullyTyped).toBeLessThan(built.coverage.totalOperations);
        expect(built.coverage.componentCount).toBe(Object.keys(document.components.schemas).length);
    });
});
