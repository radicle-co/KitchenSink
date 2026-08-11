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
 * THE DOCUMENT MAY UNDER-SPECIFY; IT MUST NEVER ASSERT WHAT THE SERVICE DOES NOT ENFORCE. Because it is read by
 * integrators and by codegen, a keyword nobody honours is worse than a missing one — a client generated from it
 * refuses bodies the service accepts, or sends bodies the service rejects. zod converts in the OUTPUT direction
 * by default, which makes three of its emissions false for a REQUEST: a stripping `z.object` looks closed, a
 * `.readonly()` looks like OpenAPI's request/response `readOnly`, and every `.int()` carries zod's safe-integer
 * sentinel as if it were an authored bound. {@link emitOnlyWhatIsTrue} is the single policy that removes each of
 * those, and refuses to emit at all where the truth cannot be expressed in one OpenAPI 3.0 Schema Object.
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
 * The subset of zod's internal schema definition this module reads.
 *
 * ⚠️ WHY AN INTERNAL SHAPE AT ALL. zod v4 publishes no introspection API for "is this object strict" or "which
 * checks does this string carry", and those two facts are exactly what decides whether the emitted document is
 * TRUE. The alternative — converting the same schema twice with `io: 'input'` and `io: 'output'` and diffing —
 * would require every component that appears in both directions to be published twice under two names, which
 * changes every `$ref` in the document to work around a missing accessor. `_zod` and `_zod.def` are part of the
 * declared surface of zod's core `$ZodType` (which is what its `override` hook hands over); the FIELDS below are
 * the internal part. Every test that pins this reads the EMITTED keywords rather than the accessor, so if a zod
 * release moves the shape, the assertions still describe the property that matters.
 */
interface ZodDefinition {
    /** zod's discriminator, e.g. `object`, `string`, `number`, `readonly`. */
    readonly type: string;
    /**
     * The unknown-key policy of an object type. `undefined` for `z.object` (STRIPS unknown keys), a `never`
     * schema for `z.strictObject` (REJECTS them), an `unknown` schema for `z.looseObject` (passes them through).
     */
    readonly catchall?: unknown;
    /** The refinements/normalizations attached to the type, in APPLICATION order. */
    readonly checks?: readonly { readonly _zod: { readonly def: ZodCheckDefinition } }[];
}

/** One check on a zod type, as far as this module needs it. */
interface ZodCheckDefinition {
    /** zod's check discriminator, e.g. `min_length`, `max_length`, `overwrite`. */
    readonly check: string;
    /** The normalization an `overwrite` check applies. */
    readonly tx?: (value: unknown) => unknown;
    /** The bound of a `min_length` check. */
    readonly minimum?: number;
    /** The bound of a `max_length` check. */
    readonly maximum?: number;
}

/**
 * Read a zod schema's definition.
 *
 * Reads `_zod.def` rather than the `.def` getter because zod's `override` hook is typed with the CORE schema
 * types, which carry `_zod` and not the classic façade's `.def`.
 *
 * @param schema - The schema to inspect.
 * @returns Its definition. Pure.
 */
function definitionOf(schema: unknown): ZodDefinition {
    return (schema as { readonly _zod: { readonly def: ZodDefinition } })._zod.def;
}

/**
 * The JSON Schema pattern that expresses "at least `minimum` characters remain after trimming".
 *
 * Exactly equivalent, not an approximation: a trimmed string spans from the first non-whitespace character to the
 * last, so its length is at least `n` precisely when the raw input contains a non-whitespace character, then at
 * least `n - 2` further characters, then another non-whitespace character. JSON Schema `pattern` is an UNANCHORED
 * search, which is what makes the surrounding whitespace irrelevant.
 *
 * @param minimum - The post-trim minimum length. Must be at least 1.
 * @returns The ECMA-262 pattern source. Pure.
 */
function trimmedMinLengthPattern(minimum: number): string {
    return minimum === 1 ? '\\S' : `\\S[\\s\\S]{${minimum - 2},}\\S`;
}

/**
 * Whether an `overwrite` check strips surrounding whitespace.
 *
 * Probed rather than inferred: zod records `.trim()`, `.toLowerCase()` and `.normalize()` as the SAME
 * `{ check: 'overwrite' }` def, distinguishable only by what the transform does. Treating every `overwrite` as a
 * trim would make `z.string().toLowerCase().min(3)` publish a non-whitespace pattern it does not require —
 * trading one lie for another.
 *
 * The probe is guarded because `tx` is arbitrary author-supplied code: a normalization that throws on an input it
 * did not expect must make this answer "not a trim", not crash generation from inside a probe.
 *
 * @param check - The check definition.
 * @returns True when the check trims. Pure.
 */
function isTrimCheck(check: ZodCheckDefinition): boolean {
    if (check.check !== 'overwrite' || check.tx === undefined) {
        return false;
    }

    try {
        return check.tx(' \t a \n ') === 'a';
    } catch {
        return false;
    }
}

/**
 * Correct the length keywords of a string whose bounds are applied AFTER a trim.
 *
 * THE LIE THIS REMOVES. `z.string().trim().min(1)` emits `minLength: 1`, so `{"name":"   "}` validates against
 * the published document and then gets a `400` from the service — the bound describes the NORMALIZED value, which
 * is not what the caller sends. The truthful statement is the equivalent pattern.
 *
 * @param schema - The string schema node.
 * @param json - The emitted JSON Schema fragment, mutated in place.
 * @throws When the truthful shape cannot be expressed in one OpenAPI 3.0 Schema Object — a `maxLength` after a
 *   trim (no finite bound on the RAW input exists, so the emitted one would refuse bodies the service accepts),
 *   or a post-trim `minLength` on a string that already carries a `pattern` (3.0 allows only one, and dropping
 *   either is a lie). Both are refused rather than silently published.
 */
function correctTrimmedStringBounds(schema: unknown, json: Record<string, unknown>): void {
    const checks = definitionOf(schema).checks ?? [];
    const trimIndex = checks.findIndex((check) => isTrimCheck(check._zod.def));

    if (trimIndex === -1) {
        return;
    }

    const afterTrim = checks.slice(trimIndex + 1).map((check) => check._zod.def);

    if (afterTrim.some((check) => check.check === 'max_length')) {
        throw new Error(
            'A published string schema applies `.max()` AFTER a whitespace-stripping `.trim()`. The emitted ' +
                '`maxLength` would describe the trimmed value, so the document would refuse a whitespace-padded ' +
                'body the service accepts, and no finite bound on the raw input exists. Move the normalization ' +
                'into the handler (server-side normalization is not part of the shape a caller must satisfy), or ' +
                'bound the raw input instead by putting `.max()` before `.trim()`.',
        );
    }

    const minimums = afterTrim
        .filter((check) => check.check === 'min_length')
        .map((check) => check.minimum ?? 0)
        .filter((minimum) => minimum >= 1);

    if (minimums.length === 0) {
        return;
    }

    if (json['pattern'] !== undefined) {
        throw new Error(
            'A published string schema applies `.min()` after a `.trim()` AND carries its own `pattern`. An ' +
                'OpenAPI 3.0 Schema Object holds one `pattern`, so the post-trim minimum cannot be published ' +
                'alongside it without dropping one of the two. Move the trim into the handler, or fold the ' +
                'non-blank requirement into the existing pattern.',
        );
    }

    json['pattern'] = trimmedMinLengthPattern(Math.max(...minimums));
}

/**
 * Make one emitted JSON Schema fragment say only what the authored zod actually requires.
 *
 * Passed to zod as its `override` hook — the library's own extension point — so it applies to every node,
 * including the inline objects nested inside a component, rather than only to the components' top level.
 *
 * ── 1. `additionalProperties` MUST TRACK THE AUTHORED STRICTNESS ──
 *
 * zod converts in the OUTPUT direction by default, where a `z.object` genuinely has no extra keys (it STRIPPED
 * them), so it emits `additionalProperties: false` for `z.object` and `z.strictObject` alike. For a REQUEST BODY
 * that erases the only distinction that matters: `z.object` accepts an unknown key and returns `2xx`, and only
 * `z.strictObject` rejects it. Measured on the real documents: ten request bodies published
 * `additionalProperties: false` while stripping, so a strict client generated from the document refuses bodies
 * the services accept. The document is for EXTERNAL consumption, so it must not assert a rejection that will not
 * happen — `false` is emitted for `z.strictObject` only, `additionalProperties: {}` still for `z.looseObject`,
 * and a stripping `z.object` says nothing (which is also the OAS-idiomatic posture for an evolvable response).
 *
 * ── 2. `readOnly` IS A DIRECTION KEYWORD, AND `.readonly()` DOES NOT MEAN IT ──
 *
 * `.readonly()` is TypeScript immutability of the parsed value. OpenAPI's `readOnly` means "sent in responses,
 * MUST NOT be sent in requests" — a claim about request/response direction that the authored zod never made and
 * that a codegen will act on. Stripped.
 *
 * ── 3. zod's SAFE-INTEGER SENTINELS ARE NOT AUTHORED BOUNDS ──
 *
 * Every `.int()` carries zod's `safeint` format, which converts to `minimum: -(2^53-1)` / `maximum: 2^53-1`. A
 * document that tells an integrator a photo may be 9 quadrillion bytes is worse than one that states no bound.
 * Only those two exact values are dropped, so a real `.int32()` (±2147483647) or an authored `.max()` survives.
 *
 * @param zodSchema - The authored node being converted.
 * @param jsonSchema - The emitted fragment, mutated in place.
 * @throws Through {@link correctTrimmedStringBounds} when a post-trim bound cannot be expressed truthfully.
 * @sideEffect Mutates `jsonSchema`, which is how zod's `override` hook is defined to work.
 */
function emitOnlyWhatIsTrue(zodSchema: unknown, jsonSchema: Record<string, unknown>): void {
    const definition = definitionOf(zodSchema);

    if (definition.type === 'object' && definition.catchall === undefined) {
        delete jsonSchema['additionalProperties'];
    }

    if (jsonSchema['readOnly'] !== undefined) {
        delete jsonSchema['readOnly'];
    }

    if (jsonSchema['maximum'] === Number.MAX_SAFE_INTEGER) {
        delete jsonSchema['maximum'];
    }

    if (jsonSchema['minimum'] === Number.MIN_SAFE_INTEGER) {
        delete jsonSchema['minimum'];
    }

    if (definition.type === 'string') {
        correctTrimmedStringBounds(zodSchema, jsonSchema);
    }
}

/** zod's `override` hook, bound to {@link emitOnlyWhatIsTrue}. Shared by every conversion in this module. */
const TRUTHFUL_OVERRIDE = (context: {
    readonly zodSchema: unknown;
    readonly jsonSchema: Record<string, unknown>;
}): void => {
    emitOnlyWhatIsTrue(context.zodSchema, context.jsonSchema);
};

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
            z.toJSONSchema(schema, { target: 'openapi-3.0', override: TRUTHFUL_OVERRIDE });
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
        override: TRUTHFUL_OVERRIDE,
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
    const { $schema: _schema, ...rest } = z.toJSONSchema(schema, {
        target: 'openapi-3.0',
        override: TRUTHFUL_OVERRIDE,
    }) as Record<string, unknown>;

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
