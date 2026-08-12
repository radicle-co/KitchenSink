/**
 * THE DRIFT GATES for `@kitchensink/schema-food`, run as tests rather than as a bespoke CI step so they
 * execute on every `npm test` and in every existing CI job, with no workflow change to forget.
 *
 * `docs/CODING_STANDARDS.md` §15.2.5 names three layers, each catching what the others cannot:
 *
 *  - **Rebuild (turbo)** — declared in `turbo.json`; content-hashing this package's `build` over the service's
 *    authored `*.schema.ts`. Not testable from here.
 *  - **Correctness (this file)** — regenerate and fail on any difference from the committed artifacts. This is
 *    the STRONG gate: it is what catches generated output somebody hand-edited.
 *  - **Skew (this file)** — `CONTRACT_HASH` must be the fingerprint of the authored sources AND identical on
 *    both sides, or the boot-time skew assertion compares a value with itself and can never fail.
 *
 * WHY IT COMPARES INSTEAD OF SHELLING OUT TO THE GENERATOR. Running the real generator here would WRITE into the
 * repository from a test: a genuinely-drifted checkout would come out of `npm test` silently REPAIRED, so the
 * gate would report success having erased its own evidence. Comparing the committed bytes against a fresh
 * in-memory derivation catches the same drift, changes nothing, and names the file that disagrees.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
    computeContractHash,
    discoverAuthoredSchemas,
    findUnpublishedSiblingImports,
    findViolations,
    flattenSiblingImports,
} from '@kitchensink/contract-gen';
import type { AuthoredSchema } from '@kitchensink/contract-gen';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import {
    ALLOWED_PACKAGE_IMPORTS,
    EXCLUDED_FILES,
    SCHEMA_PACKAGE_NAME,
    SCHEMA_PACKAGE_ROOT,
    SERVICE_PATH_PREFIX,
    SERVICE_ROOT,
    SERVICE_STAMP_PATH,
} from '../config.js';
import { foodOpenApiDocument, openApiComponents } from '../openapi.js';

/** The authored schemas, discovered once with the SAME config the generator runs with. */
const authored: AuthoredSchema[] = await discoverAuthoredSchemas(SERVICE_ROOT, { excludeFiles: EXCLUDED_FILES });

/**
 * Read a committed file from the generated package.
 *
 * @param relativePath - Path relative to the schema package root.
 * @returns The file's text.
 * @sideEffect Reads the filesystem.
 */
async function readCommitted(relativePath: string): Promise<string> {
    return readFile(join(SCHEMA_PACKAGE_ROOT, relativePath), 'utf8');
}

describe('the authored food wire contract', () => {
    it('contains at least one schema, so the package cannot be silently empty', () => {
        expect(authored.length).toBeGreaterThan(0);
    });

    // THE load-bearing safety property. A single import of a DAO type, a drizzle schema or a Nest symbol either
    // breaks the copied package outright or drags `drizzle-orm`/`@nestjs/*`/`pg`/`aws-sdk` into every consumer.
    // The predicate itself is mutation-tested in `@kitchensink/contract-gen`; this asserts it holds for the REAL
    // authored files, with this service's REAL allowlist.
    it('imports nothing but zod and flat sibling schema modules', () => {
        const violations = authored.flatMap((schema) =>
            findViolations(schema.servicePath, schema.source, ALLOWED_PACKAGE_IMPORTS),
        );

        expect(violations).toStrictEqual([]);
    });

    // The gap the allowlist alone does NOT close: `./env.schema.js` is shaped like a flat sibling schema module,
    // so `findViolations` admits it — while `EXCLUDED_FILES` keeps `env.schema.ts` out of the published package.
    // Asserted against the REAL authored files, so a future sibling import of an excluded or renamed schema fails
    // here as well as at generation time.
    it('imports no sibling schema that the generated package will not contain', () => {
        const publishedModuleNames = authored.map((schema) => schema.moduleName);
        const unresolved = authored.flatMap((schema) =>
            findUnpublishedSiblingImports(schema.servicePath, schema.source, publishedModuleNames),
        );

        expect(unresolved).toStrictEqual([]);
    });

    // Widening the allowlist is the one edit that can quietly undo the property above, so it is pinned. Changing
    // this list should require changing this assertion, which forces the reader to the reasoning in `config.ts`.
    it('allows ONLY zod at the package level — no recipe-domain dependency in the ingredient contract', () => {
        expect(ALLOWED_PACKAGE_IMPORTS.map((entry) => entry.specifier)).toStrictEqual(['zod']);
    });

    it('documents a substantive reason for every allowlist entry and every exclusion', () => {
        for (const entry of [...ALLOWED_PACKAGE_IMPORTS, ...EXCLUDED_FILES]) {
            expect(entry.why.length).toBeGreaterThan(20);
        }
    });

    // The env schema is a real `*.schema.ts` and would otherwise be published, putting this service's env-var
    // inventory into a package web and mobile depend on — and making every env change churn CONTRACT_HASH.
    it('excludes the process environment schema from the published contract', () => {
        expect(authored.map((schema) => schema.servicePath)).not.toContain('src/config/env.schema.ts');
        expect(EXCLUDED_FILES.map((entry) => entry.servicePath)).toContain('src/config/env.schema.ts');
    });
});

describe('drift layer 2 — the committed package matches a fresh generation', () => {
    it('publishes exactly the authored modules, no more and no fewer', async () => {
        const published = await readdir(join(SCHEMA_PACKAGE_ROOT, 'src/schemas'));

        expect(published.sort()).toStrictEqual(authored.map((schema) => `${schema.moduleName}.ts`).sort());
    });

    it('copies every authored schema VERBATIM, under a banner naming its source', async () => {
        for (const schema of authored) {
            const committed = await readCommitted(`src/schemas/${schema.moduleName}.ts`);

            expect(committed, `${schema.moduleName}.ts is not a verbatim copy`).toContain(
                `// Source: ${SERVICE_PATH_PREFIX}/${schema.servicePath}`,
            );
            expect(committed.endsWith(flattenSiblingImports(schema.source))).toBe(true);
        }
    });

    it('marks every generated module as generated, so nobody edits one believing it is source', async () => {
        for (const schema of authored) {
            expect(await readCommitted(`src/schemas/${schema.moduleName}.ts`)).toContain('GENERATED FILE');
        }
    });

    it('re-exports every module from the schemas barrel', async () => {
        const barrel = await readCommitted('src/schemas.ts');

        for (const schema of authored) {
            expect(barrel).toContain(`export * from './schemas/${schema.moduleName}.js';`);
        }
    });

    it('exports the zod AND the contract hash from the package root', async () => {
        const index = await readCommitted('src/index.ts');

        expect(index).toContain("export * from './schemas.js';");
        expect(index).toContain("export { CONTRACT_HASH } from './contract-hash.js';");
    });

    it('re-exports the inferred types type-only', async () => {
        expect(await readCommitted('src/types.ts')).toContain("export type * from './schemas.js';");
    });

    // The document is what integrators and `oasdiff` read. A committed copy that has drifted from the authored
    // zod is the exact failure this seam exists to prevent, one layer out.
    it('publishes an openapi.yaml identical to a fresh derivation from the authored zod', async () => {
        const committed = await readCommitted('openapi.yaml');

        expect(committed).toContain(stringify(foodOpenApiDocument.document, { lineWidth: 120 }));
    });

    it('states in openapi.yaml that it is generated and is not the type authority', async () => {
        const committed = await readCommitted('openapi.yaml');

        expect(committed).toContain('GENERATED FILE — DO NOT EDIT');
        expect(committed).toContain('NOT the type authority');
    });
});

describe('drift layer 3 — the contract hash', () => {
    const expected = computeContractHash(authored);

    it('is stamped in the schema package as the fingerprint of the authored sources', async () => {
        expect(await readCommitted('src/contract-hash.ts')).toContain(`export const CONTRACT_HASH = '${expected}';`);
    });

    // Both sides, or the runtime skew check compares a value with itself. That is the live case for mobile,
    // where a released binary cannot be updated in step with a backend deploy.
    it('is stamped identically in the SERVICE, which is what makes a skew check possible', async () => {
        const stamp = await readFile(join(SERVICE_ROOT, SERVICE_STAMP_PATH), 'utf8');

        expect(stamp).toContain(`export const CONTRACT_HASH = '${expected}';`);
    });
});

describe('the leaf property', () => {
    // The whole reason the package is a COPY rather than a re-export: a runtime dependency on NestJS, drizzle,
    // `pg` or the AWS SDK here would reach `@commise/web` and `@commise/mobile` through every consumer, and on
    // mobile that is a bundle that cannot build. Asserted at the package level, where it is decided.
    it('declares zod as its ONLY runtime dependency', async () => {
        const manifest = JSON.parse(await readCommitted('package.json')) as {
            name: string;
            dependencies: Record<string, string>;
        };

        expect(manifest.name).toBe(SCHEMA_PACKAGE_NAME);
        expect(Object.keys(manifest.dependencies)).toStrictEqual(['zod']);
    });
});

describe('openapi coverage', () => {
    // §15.2.5's known limit, turned into a gate. A response whose body is undocumented is invisible to a
    // breaking-change check, which is most of what breaks a client — so a new endpoint cannot land without one.
    it('leaves NO response body undocumented', () => {
        expect(foodOpenApiDocument.coverage.responsesWithoutSchema).toStrictEqual([]);
    });

    it('documents every operation and describes every component', () => {
        expect(foodOpenApiDocument.coverage.totalOperations).toBeGreaterThan(0);
        expect(foodOpenApiDocument.coverage.operationsFullyTyped).toBe(foodOpenApiDocument.coverage.totalOperations);
        expect(foodOpenApiDocument.coverage.componentCount).toBeGreaterThan(0);
    });

    // The routes that must never quietly become authenticated (probes) or quietly become public (everything
    // else). `security: []` is the explicit public marker; the document default covers the rest.
    it('marks only the health probes public', () => {
        const paths = foodOpenApiDocument.document['paths'] as Record<string, Record<string, { security: unknown[] }>>;

        const publicOperations = Object.entries(paths).flatMap(([path, methods]) =>
            Object.entries(methods)
                .filter(([, operation]) => operation.security.length === 0)
                .map(([method]) => `${method.toUpperCase()} ${path}`),
        );

        expect(publicOperations.sort()).toStrictEqual(['GET /health', 'GET /health/ready']);
    });

    /**
     * THE DOCUMENT'S STRICTNESS MUST MATCH THE SERVICE'S.
     *
     * `additionalProperties: false` is a promise that an unknown key is REJECTED. zod's `z.object` strips unknown
     * keys and answers `2xx`; only `z.strictObject` rejects. The generator used to emit `false` for both, so this
     * service published three request bodies (`AddFoodRequest`, `BatchAddFoodRequest`, `ResolveFoodRequest`)
     * claiming a rejection that never happens — and a strict client generated from the document refuses bodies
     * this service accepts.
     *
     * The expectation is derived BEHAVIOURALLY, by parsing a body carrying an unknown key and looking for zod's
     * `unrecognized_keys` issue — not from the same introspection the generator uses, which would make the
     * assertion agree with the generator by construction.
     */
    it('claims to reject unknown keys ONLY where the authored zod actually rejects them', () => {
        const schemas = foodOpenApiDocument.document['components'] as {
            schemas: Record<string, Record<string, unknown>>;
        };

        const disagreements = Object.entries(openApiComponents).flatMap(([name, schema]) => {
            const parsed = schema.safeParse({ __unknownKeyProbe__: 'x' });
            const rejectsUnknownKeys =
                !parsed.success && parsed.error.issues.some((issue) => issue.code === 'unrecognized_keys');
            const published = schemas.schemas[name]?.['additionalProperties'];

            if (rejectsUnknownKeys === (published === false)) {
                return [];
            }

            return [
                `${name}: the document says additionalProperties=${JSON.stringify(published)} but the zod ` +
                    `${rejectsUnknownKeys ? 'REJECTS' : 'accepts and strips'} an unknown key`,
            ];
        });

        expect(disagreements).toStrictEqual([]);
    });

    /**
     * Non-vacuity for the assertion above, in BOTH directions — and the record of which side of the line each
     * shape is on.
     *
     * That assertion compares against `=== false`, so a generator rule that stripped the keyword WHOLESALE
     * would satisfy it trivially. Two concrete populations therefore have to be named:
     *
     *  - **Every MUTATING request body claims rejection**, because each is authored as `z.strictObject` (the
     *    owner's ruling for POST/PUT/PATCH bodies). Plain `z.object` STRIPS an unknown key and answers `2xx`,
     *    which on `AddFoodRequest` means a caller who sends `ownerId` is told their field was accepted. These
     *    three published `additionalProperties: false` for a long time while actually stripping — the document
     *    already promised this behaviour, and the schemas now deliver it.
     *  - **The error envelopes stay OPEN**, because they are `.loose()` and genuinely pass unknown fields
     *    through. That is deliberate and must not be "tidied" into strictness: an error body that grows a field
     *    must not crash a client that has not been taught it, and a deployed service adds fields ahead of a
     *    released mobile binary.
     *
     * A shape that changes population fails here, which is the point: `z.object` ⇄ `z.strictObject` is a
     * BREAKING wire change in one direction and a silently-permissive one in the other, and neither should be
     * possible to make by accident.
     */
    it('claims rejection on exactly the strict request bodies, and publishes the loose error envelopes as OPEN', () => {
        const schemas = (
            foodOpenApiDocument.document['components'] as { schemas: Record<string, Record<string, unknown>> }
        ).schemas;

        const claimingRejection = Object.entries(schemas)
            .filter(([, schema]) => schema['additionalProperties'] === false)
            .map(([name]) => name)
            .sort();

        expect(claimingRejection).toStrictEqual(['AddFoodRequest', 'BatchAddFoodRequest', 'ResolveFoodRequest']);

        for (const name of ['ApiError', 'NestHttpError', 'ControllerError']) {
            expect(
                schemas[name]?.['additionalProperties'],
                `${name} is .loose() and must publish as open`,
            ).toStrictEqual({});
        }
    });

    // `z.string().trim().min(1)` emits `minLength: 1`, which `"   "` satisfies — and then this service answers
    // 400. The document must not accept a body the service refuses.
    it('does not publish a length bound that a whitespace-only name would satisfy', () => {
        const schemas = (
            foodOpenApiDocument.document['components'] as { schemas: Record<string, Record<string, unknown>> }
        ).schemas;
        const properties = schemas['AddFoodRequest']?.['properties'] as
            | Record<string, Record<string, unknown>>
            | undefined;
        const pattern = properties?.['name']?.['pattern'];

        expect(typeof pattern).toBe('string');
        expect(new RegExp(String(pattern), 'u').test('   ')).toBe(false);
        expect(openApiComponents.AddFoodRequest.safeParse({ name: '   ' }).success).toBe(false);
    });

    // The erasure route is machine-to-machine: it must NOT accept a Clerk user session, because its whole
    // authorization model is a signed token whose bound claim IS the target owner.
    it('requires the service token — not a user session — on the erasure route', () => {
        const paths = foodOpenApiDocument.document['paths'] as Record<
            string,
            Record<string, { security: Record<string, unknown>[]; requestBody?: unknown }>
        >;
        const erasure = paths['/api/v1/internal/account/erasure']?.['post'];

        expect(erasure?.security).toStrictEqual([{ serviceToken: [] }]);
        // No request body: there is no `ownerId` to smuggle past the token's bound claim.
        expect(erasure?.requestBody).toBeUndefined();
    });
});
