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

    /**
     * THE DOCUMENT MUST NOT ASSERT WHAT THE SERVICE DOES NOT ENFORCE.
     *
     * Every case here was a lie the generator shipped. The measured one: ten request bodies published
     * `additionalProperties: false` while their `z.object` STRIPPED unknown keys and returned `2xx`, so a strict
     * client generated from the document refuses bodies the services accept. Each assertion is written against
     * the emitted keywords rather than against the same introspection the generator uses, so it fails if the
     * override is removed, weakened, or applied to the wrong node.
     */
    describe('truthfulness of the emitted keywords', () => {
        /** Build a one-component document and return that component's emitted schema. */
        function componentOf(schema: z.ZodType): Record<string, unknown> {
            const { document } = buildOpenApiDocument({
                ...makeSpec(),
                components: { ...components, Subject: schema },
            } as unknown as OpenApiSpec<typeof components>);

            return at(document, 'components', 'schemas', 'Subject') as Record<string, unknown>;
        }

        it('says NOTHING about unknown keys for a stripping z.object, because it accepts and drops them', () => {
            expect(componentOf(z.object({ name: z.string() }))).not.toHaveProperty('additionalProperties');
        });

        it('publishes additionalProperties:false for a z.strictObject, which really does reject them', () => {
            expect(componentOf(z.strictObject({ name: z.string() }))['additionalProperties']).toBe(false);
        });

        it('publishes an open additionalProperties for a z.looseObject, which passes them through', () => {
            expect(componentOf(z.looseObject({ name: z.string() }))['additionalProperties']).toStrictEqual({});
        });

        // A component-level fix that missed nested objects would leave the lie everywhere it actually appears:
        // request bodies are objects OF objects.
        it('applies the same rule to an object NESTED inside a component, not just the top level', () => {
            const nested = componentOf(
                z.object({
                    stripping: z.object({ a: z.string() }),
                    strict: z.strictObject({ b: z.string() }),
                }),
            );
            const properties = nested['properties'] as Record<string, Record<string, unknown>>;

            expect(properties['stripping']).not.toHaveProperty('additionalProperties');
            expect(properties['strict']?.['additionalProperties']).toBe(false);
        });

        // `readOnly` in OpenAPI means "MUST NOT be sent in a request" — a direction claim `.readonly()` (which is
        // TypeScript immutability of the parsed value) never made, and which a codegen will act on.
        it('does not turn a .readonly() into the OpenAPI readOnly direction keyword', () => {
            const schema = componentOf(z.object({ id: z.string().readonly(), tags: z.array(z.string()).readonly() }));
            const properties = schema['properties'] as Record<string, Record<string, unknown>>;

            expect(properties['id']).toStrictEqual({ type: 'string' });
            expect(properties['tags']?.['readOnly']).toBeUndefined();
        });

        // The document told integrators a photo may be 9 quadrillion bytes.
        it('drops zod safe-integer sentinel bounds, which are not authored constraints', () => {
            const properties = componentOf(z.object({ bytes: z.number().int() }))['properties'] as Record<
                string,
                Record<string, unknown>
            >;

            expect(properties['bytes']).toStrictEqual({ type: 'integer' });
        });

        it('keeps a REAL bound, so the sentinel rule cannot swallow an authored one', () => {
            const properties = componentOf(
                z.object({ bytes: z.number().int().min(1).max(20971520), small: z.int32() }),
            )['properties'] as Record<string, Record<string, unknown>>;

            expect(properties['bytes']).toMatchObject({ minimum: 1, maximum: 20971520 });
            expect(properties['small']).toMatchObject({ minimum: -2147483648, maximum: 2147483647 });
        });

        // `z.string().trim().min(1)` emits `minLength: 1`, which `"   "` satisfies — and then the service answers
        // 400. The pattern is exactly equivalent to the post-trim bound, and `pattern` is an unanchored search,
        // which is what makes the surrounding whitespace irrelevant.
        it('publishes a non-blank pattern for a bound applied AFTER a trim', () => {
            const properties = componentOf(z.object({ name: z.string().trim().min(1) }))['properties'] as Record<
                string,
                Record<string, unknown>
            >;

            expect(properties['name']).toStrictEqual({ type: 'string', minLength: 1, pattern: '\\S' });
            expect(new RegExp(String(properties['name']?.['pattern']), 'u').test('   ')).toBe(false);
            expect(new RegExp(String(properties['name']?.['pattern']), 'u').test('  salt  ')).toBe(true);
        });

        it('scales that pattern to the declared minimum, matching the trimmed span exactly', () => {
            const properties = componentOf(z.object({ name: z.string().trim().min(3) }))['properties'] as Record<
                string,
                Record<string, unknown>
            >;
            const pattern = new RegExp(String(properties['name']?.['pattern']), 'u');

            expect(pattern.test('  ab  ')).toBe(false);
            expect(pattern.test('  abc  ')).toBe(true);
        });

        // A bound BEFORE the trim really does describe the raw input, so adding a pattern there would invent a
        // constraint the service does not have.
        it('leaves a bound applied BEFORE the trim alone', () => {
            const properties = componentOf(z.object({ name: z.string().min(2).trim() }))['properties'] as Record<
                string,
                Record<string, unknown>
            >;

            expect(properties['name']).toStrictEqual({ type: 'string', minLength: 2 });
        });

        // zod records `.trim()` and `.toLowerCase()` as the SAME `{ check: 'overwrite' }` def. Treating every
        // overwrite as a trim would publish a non-whitespace pattern that `.toLowerCase().min(3)` does not
        // require — trading one lie for another.
        it('does not mistake a case normalization for a trim', () => {
            const properties = componentOf(z.object({ code: z.string().toLowerCase().min(3) }))['properties'] as Record<
                string,
                Record<string, unknown>
            >;

            expect(properties['code']).toStrictEqual({ type: 'string', minLength: 3 });
        });

        it('applies the same corrections to an inlined parameter schema', () => {
            const { document } = buildOpenApiDocument(
                makeSpec({
                    '/api/v1/foods': {
                        get: {
                            operationId: 'search',
                            summary: 'Search',
                            parameters: [
                                { name: 'page', in: 'query', description: 'Page', schema: z.number().int() },
                                { name: 'q', in: 'query', description: 'Query', schema: z.string().trim().min(1) },
                            ],
                            responses: { '200': { description: 'ok', schema: 'FoodResponse' } },
                        },
                    },
                }),
            );
            const parameters = at(document, 'paths', '/api/v1/foods', 'get', 'parameters') as readonly Record<
                string,
                Record<string, unknown>
            >[];

            expect(parameters[0]?.['schema']).toStrictEqual({ type: 'integer' });
            expect(parameters[1]?.['schema']).toStrictEqual({ type: 'string', minLength: 1, pattern: '\\S' });
        });
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

        // zod's own failure here is a bare "Transforms cannot be represented in JSON Schema" with a stack
        // through its internals. For a document of twenty components that tells the author nothing about which
        // one to look at, which is the difference between a two-minute fix and an afternoon.
        it('names the component when zod cannot represent it, and says what to do about it', () => {
            const withTransform = {
                ...components,
                Normalized: z.object({ names: z.array(z.string()).transform((names) => names.slice(0, 1)) }),
            };

            expect(() =>
                buildOpenApiDocument({
                    ...makeSpec(),
                    components: withTransform,
                } as unknown as OpenApiSpec<typeof components>),
            ).toThrow(/Component 'Normalized' cannot be represented in JSON Schema/u);
            expect(() =>
                buildOpenApiDocument({
                    ...makeSpec(),
                    components: withTransform,
                } as unknown as OpenApiSpec<typeof components>),
            ).toThrow(/move it out of the published schema/u);
        });

        it('refuses a published string that bounds its MAXIMUM length after a trim', () => {
            const withTrimmedMax = { ...components, Padded: z.object({ note: z.string().trim().max(5) }) };

            expect(() =>
                buildOpenApiDocument({
                    ...makeSpec(),
                    components: withTrimmedMax,
                } as unknown as OpenApiSpec<typeof components>),
            ).toThrow(/`\.max\(\)` AFTER a whitespace-stripping `\.trim\(\)`/u);
        });

        // OpenAPI 3.0 holds ONE `pattern` per Schema Object, so the post-trim minimum and an authored regex
        // cannot both be published — and silently dropping either is the lie this whole hook removes.
        it('refuses a post-trim minimum on a string that already carries its own pattern', () => {
            const both = {
                ...components,
                Slug: z.object({
                    slug: z
                        .string()
                        .regex(/^[a-z-]+$/u)
                        .trim()
                        .min(2),
                }),
            };

            expect(() =>
                buildOpenApiDocument({
                    ...makeSpec(),
                    components: both,
                } as unknown as OpenApiSpec<typeof components>),
            ).toThrow(/carries its own `pattern`/u);
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
