/**
 * OPENAPI DERIVATION — turns a service's authored zod into the `openapi.yaml` the schema package publishes.
 *
 * WHAT THIS ARTIFACT IS, AND IS NOT (`docs/CODING_STANDARDS.md` §15.2.1). It is a **derived artifact for
 * external consumption** — `oasdiff`, published docs, third-party integrators. It is **NOT** a code-generation
 * input and **NOT** the type authority: nothing in this repo compiles against it. Derivation flows one way,
 * zod → OpenAPI, and never back, because JSON Schema cannot express `readonly`, branded types or template
 * literals, so deriving types THROUGH it would degrade the strong gate (typecheck) to serve the weak artifact.
 *
 * WHY NOT `@nestjs/swagger`. §15.2.5 records its blindness honestly: it emits **no response schema** for a
 * handler returning an `interface`, which is most of what actually breaks a client. Both services here return
 * interfaces from every handler, so a swagger-derived document would be structurally blind exactly where a
 * breaking-change gate needs sight. Deriving from the authored zod instead means the document's response
 * schemas are the same definition the service validates with.
 *
 * DESIGN PATTERN: Builder over a declarative spec, plus a Registry for the component schemas.
 * {@link buildOpenApiDocument} is PURE — it takes the spec and returns the document plus a coverage report,
 * touching no filesystem — so it is unit-testable without generating anything.
 *
 * HOW THE DISCRIMINATED-UNION HAZARD IS HANDLED. §15.2's superseded-design note warns that a generated schema
 * which silently flattens a union to `object` is "a contract that lies". zod's own `toJSONSchema` emits
 * `anyOf`/`oneOf` for a union rather than collapsing it, and {@link assertNoOpaqueSchemas} then REFUSES to emit
 * any component that degenerated to a bare `{"type":"object"}` with no properties and no composition keyword —
 * so a lie of that shape fails generation instead of shipping.
 */
import { z } from 'zod';
import type { ZodType } from 'zod';

/** HTTP methods a path item may declare. Lower-case, as OpenAPI requires. */
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Where a parameter is carried. */
export type ParameterLocation = 'path' | 'query' | 'header';

/** One operation parameter. Scalars are inlined; a parameter is never a component reference. */
export interface OpenApiParameter {
    /** The parameter name as it appears on the wire. */
    readonly name: string;
    /** Where it is carried. */
    readonly in: ParameterLocation;
    /** Whether the operation requires it. A `path` parameter is always required. */
    readonly required?: boolean;
    /** Human-readable purpose. */
    readonly description: string;
    /** The zod schema for the parameter's value (a scalar; inlined into the document). */
    readonly schema: ZodType;
}

/**
 * One response. `schema` names a COMPONENT — a key of the spec's `components` map — rather than carrying a zod
 * value, so a typo is a `typecheck` failure rather than a silently-missing schema, and every response body on
 * the wire is a named, `$ref`-able shape.
 */
export interface OpenApiResponse<TComponentName extends string> {
    /** What this status means for this operation. */
    readonly description: string;
    /**
     * The component holding the response body's shape. OMITTED means "this response has no body, or its body
     * is deliberately undocumented" — and every omission is counted and reported by
     * {@link OpenApiCoverage}, because an undocumented response body is precisely the blindness §15.2.5 warns
     * about, and it must be visible rather than assumed absent.
     */
    readonly schema?: TComponentName;
    /** Response media type; defaults to `application/json`. */
    readonly contentType?: string;
    /** Response headers this status sets, e.g. `Retry-After`. */
    readonly headers?: Readonly<Record<string, { readonly description: string; readonly schema: ZodType }>>;
}

/** One operation on a path. */
export interface OpenApiOperation<TComponentName extends string> {
    /** Stable machine identifier, unique across the document. */
    readonly operationId: string;
    /** One-line summary. */
    readonly summary: string;
    /** Longer prose, when the summary is not enough. */
    readonly description?: string;
    /**
     * Names of the security schemes that satisfy this operation. An EMPTY array means the operation is
     * deliberately public (health probes); `undefined` inherits the document-level requirement. Spelled
     * explicitly rather than defaulted, because "did anyone decide this endpoint is public?" is the question
     * a reader of a generated document most needs answered.
     */
    readonly security?: readonly string[];
    /** Path/query/header parameters. */
    readonly parameters?: readonly OpenApiParameter[];
    /** The request body, when the operation takes one. */
    readonly requestBody?: {
        readonly description: string;
        readonly required?: boolean;
        readonly schema: TComponentName;
        readonly contentType?: string;
    };
    /** Responses by status code (as a string key, e.g. `'200'`). */
    readonly responses: Readonly<Record<string, OpenApiResponse<TComponentName>>>;
}

/** The declarative document spec a service authors in its `contract/` directory. */
export interface OpenApiSpec<TComponents extends Readonly<Record<string, ZodType>>> {
    /** Document title, e.g. `Commise Food (Ingredient) API`. */
    readonly title: string;
    /** Document version. */
    readonly version: string;
    /** Document description. */
    readonly description: string;
    /** Declared servers. */
    readonly servers: readonly { readonly url: string; readonly description: string }[];
    /** Security schemes by name, as OpenAPI security-scheme objects. */
    readonly securitySchemes: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    /** The default security requirement, referenced by name, applied to operations that declare none. */
    readonly defaultSecurity: readonly string[];
    /** The named component schemas — the authored zod, keyed by the name it is published under. */
    readonly components: TComponents;
    /** The paths, each mapping methods to operations. */
    readonly paths: Readonly<Record<string, Partial<Record<HttpMethod, OpenApiOperation<keyof TComponents & string>>>>>;
}

/** How much of the document actually carries a response schema — the §15.2.5 blindness, measured. */
export interface OpenApiCoverage {
    /** Total operations in the document. */
    readonly totalOperations: number;
    /** Operations whose every declared response either has a schema or is a legitimately body-less status. */
    readonly operationsFullyTyped: number;
    /** `operationId statusCode` pairs whose response body is NOT described. Sorted, so the report is stable. */
    readonly responsesWithoutSchema: readonly string[];
    /** Component schemas emitted. */
    readonly componentCount: number;
}

/** The result of a build: the document to serialize, plus what it does and does not cover. */
export interface OpenApiBuildResult {
    /** The OpenAPI 3.0.3 document, ready to serialize to YAML. */
    readonly document: Readonly<Record<string, unknown>>;
    /** The coverage report. */
    readonly coverage: OpenApiCoverage;
}

/** Statuses that legitimately carry no response body, so omitting a schema for them is not a gap. */
const BODYLESS_STATUSES: readonly string[] = ['204', '304'];

/**
 * Convert a spec's components into OpenAPI `components.schemas`, with real `$ref`s between them.
 *
 * Uses zod's REGISTRY mode rather than converting each schema independently: converting independently would
 * inline a shared shape (`NutrientView`) into every parent that uses it, so a reader could not tell that two
 * inlined copies are one type, and `oasdiff` would report an unrelated change at every use site.
 *
 * Each component is ALSO converted on its own first, purely so that a schema zod cannot represent — most often
 * a `.transform()` — fails with the component's NAME attached. zod's own error is a bare
 * "Transforms cannot be represented in JSON Schema" with a stack through its internals, which for a document of
 * twenty components tells the author nothing about which one to look at.
 *
 * @param components - Name → zod schema.
 * @returns The `components.schemas` object.
 * @throws When zod cannot represent a schema in JSON Schema, naming the component and the reason.
 */
function buildComponentSchemas(components: Readonly<Record<string, ZodType>>): Record<string, Record<string, unknown>> {
    const registry = z.registry<{ id: string }>();

    for (const [name, schema] of Object.entries(components)) {
        try {
            z.toJSONSchema(schema, { target: 'openapi-3.0' });
        } catch (error) {
            throw new Error(
                `Component '${name}' cannot be represented in JSON Schema: ${error instanceof Error ? error.message : String(error)}. ` +
                    'A `.transform()`/`.pipe()` is the usual cause. Server-side normalization is not part of the ' +
                    'shape a caller must satisfy — move it out of the published schema and into the handler.',
                { cause: error },
            );
        }

        registry.add(schema, { id: name });
    }

    const converted = z.toJSONSchema(registry, {
        target: 'openapi-3.0',
        uri: (id) => `#/components/schemas/${id}`,
    }) as { schemas: Record<string, Record<string, unknown>> };

    const schemas: Record<string, Record<string, unknown>> = {};

    for (const [name, jsonSchema] of Object.entries(converted.schemas)) {
        // `$id` and `$schema` are JSON-Schema vocabulary that an OpenAPI 3.0 Schema Object does not define.
        // Emitting them makes some validators reject the document, and they carry no information a reader
        // needs — the component's key already IS its name.
        const { $id: _id, $schema: _schema, ...rest } = jsonSchema;

        schemas[name] = rest;
    }

    return schemas;
}

/**
 * Refuse to emit a component that degenerated into an opaque `object`.
 *
 * This is the guard against §15.2's "a contract that lies": a component with no `properties`, no `anyOf`/
 * `oneOf`/`allOf` and no `additionalProperties` schema tells a client nothing while LOOKING like a described
 * type, which is strictly worse than an absent schema — a client would generate an empty type from it and
 * believe the endpoint returns nothing.
 *
 * @param schemas - The converted component schemas.
 * @throws When any component is opaque, naming every offender at once.
 */
function assertNoOpaqueSchemas(schemas: Readonly<Record<string, Record<string, unknown>>>): void {
    const opaque = Object.entries(schemas)
        .filter(([, schema]) => {
            if (schema['type'] !== 'object') {
                return false;
            }

            const properties = schema['properties'];
            const hasProperties =
                properties !== null && typeof properties === 'object' && Object.keys(properties).length > 0;
            const composes = ['anyOf', 'oneOf', 'allOf'].some((key) => schema[key] !== undefined);
            const hasValueSchema = typeof schema['additionalProperties'] === 'object';

            return !hasProperties && !composes && !hasValueSchema;
        })
        .map(([name]) => name);

    if (opaque.length > 0) {
        throw new Error(
            `Opaque component schema(s): ${opaque.join(', ')}. Each converted to a bare {"type":"object"} ` +
                'with no properties and no composition, which describes nothing while looking described — a ' +
                'contract that lies. Model the shape explicitly (z.object / z.discriminatedUnion / ' +
                'z.record(valueSchema)) instead of z.object({}) or z.record(z.unknown()).',
        );
    }
}

/**
 * Convert a parameter's or header's inline zod schema to a JSON Schema fragment.
 *
 * @param schema - The zod schema.
 * @returns The OpenAPI 3.0 schema object. Pure apart from zod's own conversion.
 */
function inlineSchema(schema: ZodType): Record<string, unknown> {
    const { $schema: _schema, ...rest } = z.toJSONSchema(schema, { target: 'openapi-3.0' }) as Record<string, unknown>;

    return rest;
}

/**
 * Build the OpenAPI document and its coverage report from a declarative spec.
 *
 * @param spec - The document spec (components + paths), authored in the service's `contract/` directory.
 * @returns The document and the coverage report.
 * @throws When two operations share an `operationId` (an ambiguous document, and a codegen hazard for any
 *   integrator), or when a component schema is opaque.
 */
export function buildOpenApiDocument<TComponents extends Readonly<Record<string, ZodType>>>(
    spec: OpenApiSpec<TComponents>,
): OpenApiBuildResult {
    const schemas = buildComponentSchemas(spec.components);

    assertNoOpaqueSchemas(schemas);

    const paths: Record<string, Record<string, unknown>> = {};
    const operationIds: string[] = [];
    const responsesWithoutSchema: string[] = [];
    let totalOperations = 0;
    let operationsFullyTyped = 0;

    for (const [path, methods] of Object.entries(spec.paths)) {
        const pathItem: Record<string, unknown> = {};

        for (const [method, operation] of Object.entries(methods)) {
            if (operation === undefined) {
                continue;
            }

            totalOperations += 1;
            operationIds.push(operation.operationId);

            const gaps = Object.entries(operation.responses)
                .filter(([status, response]) => response.schema === undefined && !BODYLESS_STATUSES.includes(status))
                .map(([status]) => `${operation.operationId} ${status}`);

            responsesWithoutSchema.push(...gaps);

            if (gaps.length === 0) {
                operationsFullyTyped += 1;
            }

            pathItem[method] = renderOperation(operation, spec.defaultSecurity);
        }

        paths[path] = pathItem;
    }

    const duplicateIds = operationIds.filter((id, index) => operationIds.indexOf(id) !== index);

    if (duplicateIds.length > 0) {
        throw new Error(
            `Duplicate operationId(s): ${[...new Set(duplicateIds)].join(', ')}. An operationId is the handle ` +
                'every integrator generates a method name from, so a duplicate silently overwrites a method.',
        );
    }

    const document: Record<string, unknown> = {
        openapi: '3.0.3',
        info: { title: spec.title, version: spec.version, description: spec.description },
        servers: spec.servers.map((server) => ({ url: server.url, description: server.description })),
        security: spec.defaultSecurity.map((name) => ({ [name]: [] })),
        paths,
        components: { securitySchemes: spec.securitySchemes, schemas },
    };

    return {
        document,
        coverage: {
            totalOperations,
            operationsFullyTyped,
            responsesWithoutSchema: [...responsesWithoutSchema].sort(),
            componentCount: Object.keys(schemas).length,
        },
    };
}

/**
 * Render one operation into its OpenAPI object.
 *
 * @param operation - The authored operation.
 * @param defaultSecurity - The document-level security requirement, applied when the operation declares none.
 * @returns The OpenAPI Operation Object. Pure apart from zod's conversion of inline parameter schemas.
 */
function renderOperation<TComponentName extends string>(
    operation: OpenApiOperation<TComponentName>,
    defaultSecurity: readonly string[],
): Record<string, unknown> {
    const security = operation.security ?? defaultSecurity;

    const rendered: Record<string, unknown> = {
        operationId: operation.operationId,
        summary: operation.summary,
        security: security.map((name) => ({ [name]: [] })),
        responses: Object.fromEntries(
            Object.entries(operation.responses).map(([status, response]) => [status, renderResponse(response)]),
        ),
    };

    if (operation.description !== undefined) {
        rendered['description'] = operation.description;
    }

    if (operation.parameters !== undefined && operation.parameters.length > 0) {
        rendered['parameters'] = operation.parameters.map((parameter) => ({
            name: parameter.name,
            in: parameter.in,
            required: parameter.required ?? parameter.in === 'path',
            description: parameter.description,
            schema: inlineSchema(parameter.schema),
        }));
    }

    if (operation.requestBody !== undefined) {
        rendered['requestBody'] = {
            description: operation.requestBody.description,
            required: operation.requestBody.required ?? true,
            content: {
                [operation.requestBody.contentType ?? 'application/json']: {
                    schema: { $ref: `#/components/schemas/${operation.requestBody.schema}` },
                },
            },
        };
    }

    return rendered;
}

/**
 * Render one response into its OpenAPI object.
 *
 * @param response - The authored response.
 * @returns The OpenAPI Response Object. Pure apart from zod's conversion of inline header schemas.
 */
function renderResponse<TComponentName extends string>(
    response: OpenApiResponse<TComponentName>,
): Record<string, unknown> {
    const rendered: Record<string, unknown> = { description: response.description };

    if (response.schema !== undefined) {
        rendered['content'] = {
            [response.contentType ?? 'application/json']: {
                schema: { $ref: `#/components/schemas/${response.schema}` },
            },
        };
    }

    if (response.headers !== undefined) {
        rendered['headers'] = Object.fromEntries(
            Object.entries(response.headers).map(([name, header]) => [
                name,
                { description: header.description, schema: inlineSchema(header.schema) },
            ]),
        );
    }

    return rendered;
}
