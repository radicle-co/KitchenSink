/**
 * THE DRIFT GATES for `@kitchensink/schema-identity`, run as tests rather than as a bespoke CI step so they
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
    collectComposedSources,
    discoverAuthoredSchemas,
    findViolations,
    flattenSiblingImports,
} from '@kitchensink/contract-gen';
import type { AuthoredSchema, ComposedSource } from '@kitchensink/contract-gen';
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
import { identityOpenApiDocument } from '../openapi.js';

/** The authored schemas, discovered once with the SAME config the generator runs with. */
const authored: AuthoredSchema[] = await discoverAuthoredSchemas(SERVICE_ROOT, { excludeFiles: EXCLUDED_FILES });

/**
 * The COMPOSED sources the authored schemas build their shapes from — EMPTY for this service, and that emptiness
 * is an assertion below rather than an assumption.
 *
 * `CONTRACT_HASH` fingerprints the authored `*.schema.ts` files AND every source they transitively reach through
 * an allowlisted package import, because a hash over the authored files alone did not move when a shape defined
 * in a composed leaf changed — drift layer 3 certified skew as agreement. This service's allowlist is zod-only, so
 * it reaches nothing and its fingerprint is unchanged. Collected with the SAME call the generator makes, so if the
 * allowlist is ever widened this test follows automatically instead of pinning a stale empty corpus.
 */
const composed: readonly ComposedSource[] = await collectComposedSources(authored, { serviceRoot: SERVICE_ROOT });

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

describe('the authored identity wire contract', () => {
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

    // Widening the allowlist is the one edit that can quietly undo the property above, so it is pinned.
    // `@commise/features-account`, `@commise/web` and `@commise/mobile` all depend on the generated package, so a
    // widening here reaches the MOBILE BUNDLE. Changing this list should require changing this assertion, which
    // forces the reader to the reasoning in `config.ts`.
    it('allows ONLY zod at the package level, because a widening here reaches the mobile bundle', () => {
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
        expect(index).toContain("export { CONTRACT_HASH } from './contractHash.js';");
    });

    it('re-exports the inferred types type-only', async () => {
        expect(await readCommitted('src/types.ts')).toContain("export type * from './schemas.js';");
    });

    // The document is what integrators and `oasdiff` read. A committed copy that has drifted from the authored
    // zod is the exact failure this seam exists to prevent, one layer out.
    it('publishes an openapi.yaml identical to a fresh derivation from the authored zod', async () => {
        const committed = await readCommitted('openapi.yaml');

        expect(committed).toContain(stringify(identityOpenApiDocument.document, { lineWidth: 120 }));
    });

    it('states in openapi.yaml that it is generated and is not the type authority', async () => {
        const committed = await readCommitted('openapi.yaml');

        expect(committed).toContain('GENERATED FILE — DO NOT EDIT');
        expect(committed).toContain('NOT the type authority');
    });
});

describe('drift layer 3 — the contract hash', () => {
    const expected = computeContractHash(authored, composed);

    /*
     * What this asserts, stated precisely, because an earlier draft of this comment over-claimed and that is the
     * same class of defect as the blindness being fixed.
     *
     * It pins THIS SERVICE to composing nothing. If someone widens the import allowlist — the reviewed decision
     * that admits a package's whole transitive graph into a leaf web and mobile depend on — this fails, so the
     * fingerprint consequences of that widening cannot arrive unnoticed.
     *
     * It does NOT prove the collector still works: a collector that had stopped following imports entirely would
     * also return `[]` here. That property is guarded where it can actually be observed, in the RECIPE service's
     * contract test, which requires `@kitchensink/recipe-core/src/recipe.types.ts` by name. All three services
     * share one collector, so recipe's non-vacuity assertion is the liveness check for this one too.
     */
    it('reaches no composed source, because the allowlist is zod-only', () => {
        expect(composed).toStrictEqual([]);
        expect(ALLOWED_PACKAGE_IMPORTS.map((entry) => entry.specifier)).toStrictEqual(['zod']);
    });

    it('is stamped in the schema package as the fingerprint of the authored sources', async () => {
        expect(await readCommitted('src/contractHash.ts')).toContain(`export const CONTRACT_HASH = '${expected}';`);
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
        expect(identityOpenApiDocument.coverage.responsesWithoutSchema).toStrictEqual([]);
    });

    it('documents every operation and describes every component', () => {
        expect(identityOpenApiDocument.coverage.totalOperations).toBeGreaterThan(0);
        expect(identityOpenApiDocument.coverage.operationsFullyTyped).toBe(
            identityOpenApiDocument.coverage.totalOperations,
        );
        expect(identityOpenApiDocument.coverage.componentCount).toBeGreaterThan(0);
    });

    // The routes that must never quietly become authenticated (probes) or quietly become public (everything
    // else). `security: []` is the explicit public marker; the document default covers the rest.
    it('marks only the health probes public', () => {
        const paths = identityOpenApiDocument.document['paths'] as Record<
            string,
            Record<string, { security: unknown[] }>
        >;

        const publicOperations = Object.entries(paths).flatMap(([path, methods]) =>
            Object.entries(methods)
                .filter(([, operation]) => operation.security.length === 0)
                .map(([method]) => `${method.toUpperCase()} ${path}`),
        );

        expect(publicOperations.sort()).toStrictEqual(['GET /health', 'GET /health/ready']);
    });

    // The admin surface must never quietly become reachable without the `admin:users` scope. The document is not
    // the enforcer — `ScopesGuard` is — but a document that stopped SAYING an admin route is protected is how a
    // published contract starts inviting unauthenticated calls, so the requirement is asserted here too.
    it('requires the session token on every admin and profile route', () => {
        const paths = identityOpenApiDocument.document['paths'] as Record<
            string,
            Record<string, { security: Record<string, unknown>[] }>
        >;

        const protectedOperations = Object.entries(paths)
            .filter(([path]) => path.startsWith('/api/'))
            .flatMap(([, methods]) => Object.values(methods));

        expect(protectedOperations.length).toBeGreaterThan(0);

        for (const operation of protectedOperations) {
            expect(operation.security).toStrictEqual([{ clerkSession: [] }]);
        }
    });
});
