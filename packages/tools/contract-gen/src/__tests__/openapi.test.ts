/**
 * Unit tests for the OpenAPI derivation.
 *
 * The cases that matter are not "does it emit a document" — they are the ones that keep the document from
 * LYING: a shared shape must be `$ref`'d rather than inlined twice, a union must survive as a composition
 * rather than flattening to `object`, an opaque component must be refused, and every response without a body
 * schema must be COUNTED (the §15.2.5 blindness, made visible rather than assumed absent).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildOpenApiDocument } from '../openapi.js';
import type { OpenApiSpec } from '../openapi.js';

const nutrientSchema = z.object({ nutrient: z.string(), amount: z.number() });
const foodSchema = z.object({ id: z.string(), nutrients: z.array(nutrientSchema) });
const pendingSchema = z.object({ id: z.string(), status: z.literal('PENDING') });
const eitherSchema = z.discriminatedUnion('status', [
    z.object({ status: z.literal('RESOLVED'), food: foodSchema }),
    z.object({ status: z.literal('PENDING'), id: z.string() }),
]);
const errorSchema = z.object({ code: z.string(), message: z.string() });

const components = {
    FoodResponse: foodSchema,
    NutrientView: nutrientSchema,
    PendingResponse: pendingSchema,
    GetFoodResult: eitherSchema,
    ApiError: errorSchema,
};

/** A minimal but complete spec, so each test varies exactly one thing. */
function makeSpec(
    paths: OpenApiSpec<typeof components>['paths'] = {
        '/api/v1/foods/{id}': {
            get: {
                operationId: 'getFood',
                summary: 'Read a golden record',
                parameters: [{ name: 'id', in: 'path', description: 'The internal food id', schema: z.string() }],
                responses: {
                    '200': { description: 'The golden record', schema: 'FoodResponse' },
                    '404': { description: 'No such food', schema: 'ApiError' },
                },
            },
        },
    },
): OpenApiSpec<typeof components> {
    return {
        title: 'Food API',
        version: '1.0.0',
        description: 'Ingredients.',
        servers: [{ url: 'https://food.commise.app', description: 'production' }],
        securitySchemes: { clerkSession: { type: 'http', scheme: 'bearer' } },
        defaultSecurity: ['clerkSession'],
        components,
        paths,
    };
}

/** Read a nested path out of the built document without `any`. */
function at(document: Readonly<Record<string, unknown>>, ...keys: readonly string[]): unknown {
    return keys.reduce<unknown>(
        (node, key) => (node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined),
        document,
    );
}

describe('buildOpenApiDocument', () => {
    it('emits a 3.0.3 document with the info, servers and security schemes it was given', () => {
        const { document } = buildOpenApiDocument(makeSpec());

        expect(document['openapi']).toBe('3.0.3');
        expect(at(document, 'info', 'title')).toBe('Food API');
        expect(at(document, 'info', 'version')).toBe('1.0.0');
        expect(at(document, 'components', 'securitySchemes', 'clerkSession', 'scheme')).toBe('bearer');
        expect(document['security']).toStrictEqual([{ clerkSession: [] }]);
    });

    it('emits one component schema per entry, keyed by its published name', () => {
        const { document, coverage } = buildOpenApiDocument(makeSpec());
        const schemas = at(document, 'components', 'schemas') as Record<string, unknown>;

        expect(Object.keys(schemas).sort()).toStrictEqual([
            'ApiError',
            'FoodResponse',
            'GetFoodResult',
            'NutrientView',
            'PendingResponse',
        ]);
        expect(coverage.componentCount).toBe(5);
    });

    // Converting each component independently would INLINE `NutrientView` inside `FoodResponse`, so a reader
    // could not tell the two are one type and oasdiff would report an unrelated change at every use site.
    it('cross-references a shared shape instead of inlining a second copy of it', () => {
        const { document } = buildOpenApiDocument(makeSpec());

        expect(at(document, 'components', 'schemas', 'FoodResponse', 'properties', 'nutrients', 'items')).toStrictEqual(
            {
                $ref: '#/components/schemas/NutrientView',
            },
        );
    });

    // §15.2's recorded hazard: a generated schema that silently flattens a union to `object` is a contract that
    // lies. It must survive as a composition.
    it('keeps a discriminated union as a composition rather than flattening it to object', () => {
        const { document } = buildOpenApiDocument(makeSpec());
        const union = at(document, 'components', 'schemas', 'GetFoodResult') as Record<string, unknown>;
        const branches = (union['anyOf'] ?? union['oneOf']) as readonly unknown[] | undefined;

        expect(branches).toBeDefined();
        expect(branches).toHaveLength(2);
        expect(union['type']).not.toBe('object');
    });

    it('strips the JSON-Schema-only $id and $schema keys that OpenAPI 3.0 does not define', () => {
        const { document } = buildOpenApiDocument(makeSpec());
        const schema = at(document, 'components', 'schemas', 'NutrientView') as Record<string, unknown>;

        expect(schema['$id']).toBeUndefined();
        expect(schema['$schema']).toBeUndefined();
    });

    it('references a response body by $ref to its named component', () => {
        const { document } = buildOpenApiDocument(makeSpec());

        expect(
            at(
                document,
                'paths',
                '/api/v1/foods/{id}',
                'get',
                'responses',
                '200',
                'content',
                'application/json',
                'schema',
            ),
        ).toStrictEqual({ $ref: '#/components/schemas/FoodResponse' });
    });

    it('marks a path parameter required without being told', () => {
        const { document } = buildOpenApiDocument(makeSpec());
        const parameters = at(document, 'paths', '/api/v1/foods/{id}', 'get', 'parameters') as readonly Record<
            string,
            unknown
        >[];

        expect(parameters[0]).toMatchObject({ name: 'id', in: 'path', required: true });
        expect(parameters[0]?.['schema']).toStrictEqual({ type: 'string' });
    });

    it('leaves a query parameter optional unless told otherwise', () => {
        const { document } = buildOpenApiDocument(
            makeSpec({
                '/api/v1/foods/search': {
                    get: {
                        operationId: 'search',
                        summary: 'Search',
                        parameters: [{ name: 'query', in: 'query', description: 'The query', schema: z.string() }],
                        responses: { '200': { description: 'Hits', schema: 'FoodResponse' } },
                    },
                },
            }),
        );
        const parameters = at(document, 'paths', '/api/v1/foods/search', 'get', 'parameters') as readonly Record<
            string,
            unknown
        >[];

        expect(parameters[0]?.['required']).toBe(false);
    });

    it('renders a request body as a required $ref by default', () => {
        const { document } = buildOpenApiDocument(
            makeSpec({
                '/api/v1/foods': {
                    post: {
                        operationId: 'addByName',
                        summary: 'Add by name',
                        requestBody: { description: 'The name', schema: 'PendingResponse' },
                        responses: { '202': { description: 'Accepted', schema: 'PendingResponse' } },
                    },
                },
            }),
        );
        const body = at(document, 'paths', '/api/v1/foods', 'post', 'requestBody') as Record<string, unknown>;

        expect(body['required']).toBe(true);
        expect(at(body, 'content', 'application/json', 'schema')).toStrictEqual({
            $ref: '#/components/schemas/PendingResponse',
        });
    });

    it('renders declared response headers', () => {
        const { document } = buildOpenApiDocument(
            makeSpec({
                '/api/v1/foods': {
                    post: {
                        operationId: 'addByName',
                        summary: 'Add by name',
                        responses: {
                            '503': {
                                description: 'Shed',
                                schema: 'ApiError',
                                headers: { 'Retry-After': { description: 'Seconds', schema: z.number() } },
                            },
                        },
                    },
                },
            }),
        );

        expect(
            at(document, 'paths', '/api/v1/foods', 'post', 'responses', '503', 'headers', 'Retry-After'),
        ).toMatchObject({ description: 'Seconds' });
    });

    // "Is this endpoint deliberately public?" is the question a reader of a generated document most needs
    // answered, so an empty security array must render as an empty requirement rather than inheriting the default.
    it('renders an explicitly public operation with no security requirement', () => {
        const { document } = buildOpenApiDocument(
            makeSpec({
                '/health': {
                    get: {
                        operationId: 'getHealth',
                        summary: 'Liveness',
                        security: [],
                        responses: { '200': { description: 'ok', schema: 'ApiError' } },
                    },
                },
            }),
        );

        expect(at(document, 'paths', '/health', 'get', 'security')).toStrictEqual([]);
    });

    it('applies the document default security to an operation that declares none', () => {
        const { document } = buildOpenApiDocument(makeSpec());

        expect(at(document, 'paths', '/api/v1/foods/{id}', 'get', 'security')).toStrictEqual([{ clerkSession: [] }]);
    });

    describe('coverage', () => {
        it('counts every operation', () => {
            const { coverage } = buildOpenApiDocument(makeSpec());

            expect(coverage.totalOperations).toBe(1);
            expect(coverage.operationsFullyTyped).toBe(1);
            expect(coverage.responsesWithoutSchema).toStrictEqual([]);
        });

        // THE point of the report: an undocumented response body must be named, not assumed absent.
        it('names each response that has no body schema', () => {
            const { coverage } = buildOpenApiDocument(
                makeSpec({
                    '/api/v1/foods/{id}': {
                        get: {
                            operationId: 'getFood',
                            summary: 'Read',
                            responses: {
                                '200': { description: 'ok', schema: 'FoodResponse' },
                                '404': { description: 'missing' },
                                '500': { description: 'boom' },
                            },
                        },
                    },
                }),
            );

            expect(coverage.responsesWithoutSchema).toStrictEqual(['getFood 404', 'getFood 500']);
            expect(coverage.operationsFullyTyped).toBe(0);
            expect(coverage.totalOperations).toBe(1);
        });

        it('does not count a legitimately body-less status as a gap', () => {
            const { coverage } = buildOpenApiDocument(
                makeSpec({
                    '/api/v1/foods/{id}': {
                        delete: {
                            operationId: 'deleteFood',
                            summary: 'Delete',
                            responses: { '204': { description: 'Deleted' } },
                        },
                    },
                }),
            );

            expect(coverage.responsesWithoutSchema).toStrictEqual([]);
            expect(coverage.operationsFullyTyped).toBe(1);
        });

        it('counts operations across every method of every path', () => {
            const { coverage } = buildOpenApiDocument(
                makeSpec({
                    '/api/v1/foods': {
                        get: {
                            operationId: 'listFoods',
                            summary: 'List',
                            responses: { '200': { description: 'ok', schema: 'FoodResponse' } },
                        },
                        post: {
                            operationId: 'addFood',
                            summary: 'Add',
                            responses: { '202': { description: 'ok', schema: 'PendingResponse' } },
                        },
                    },
                    '/api/v1/foods/{id}': {
                        patch: {
                            operationId: 'resolveFood',
                            summary: 'Resolve',
                            responses: { '200': { description: 'ok', schema: 'FoodResponse' } },
                        },
                    },
                }),
            );

            expect(coverage.totalOperations).toBe(3);
        });
    });

    describe('refusals', () => {
        // An operationId is the handle every integrator generates a method name from, so a duplicate silently
        // overwrites a method in the generated client.
        it('refuses a duplicate operationId across paths', () => {
            expect(() =>
                buildOpenApiDocument(
                    makeSpec({
                        '/a': {
                            get: {
                                operationId: 'same',
                                summary: 'A',
                                responses: { '200': { description: 'ok', schema: 'FoodResponse' } },
                            },
                        },
                        '/b': {
                            get: {
                                operationId: 'same',
                                summary: 'B',
                                responses: { '200': { description: 'ok', schema: 'FoodResponse' } },
                            },
                        },
                    }),
                ),
            ).toThrow(/Duplicate operationId/u);
        });

        it('refuses an opaque component that describes nothing while looking described', () => {
            const opaque = { ...components, Opaque: z.object({}) };

            expect(() =>
                buildOpenApiDocument({
                    ...makeSpec(),
                    components: opaque,
                } as unknown as OpenApiSpec<typeof components>),
            ).toThrow(/Opaque component schema/u);
        });

        it('accepts a record whose VALUES are described, which is not opaque', () => {
            const withRecord = { ...components, Provenance: z.record(z.string(), z.string()) };

            expect(() =>
                buildOpenApiDocument({
                    ...makeSpec(),
                    components: withRecord,
                } as unknown as OpenApiSpec<typeof components>),
            ).not.toThrow();
        });
    });
});
