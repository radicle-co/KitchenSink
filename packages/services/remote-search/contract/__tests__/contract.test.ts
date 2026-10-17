/**
 * THE DRIFT GATES for `@kitchensink/schema-remote-search` (`docs/CODING_STANDARDS.md` §15.2.5), run as tests so they
 * execute on every `npm test`. Layer 1 (rebuild) is `turbo.json`'s; this file holds layer 2 (the committed package
 * matches a fresh derivation from the authored zod) and layer 3 (`CONTRACT_HASH` is the fingerprint of the authored
 * sources, on both sides).
 *
 * It compares rather than shelling out to the generator, so a drifted checkout fails here instead of coming out of
 * `npm test` silently repaired.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
    collectComposedSources,
    computeContractHash,
    discoverAuthoredSchemas,
    findViolations,
    flattenSiblingImports,
} from '@kitchensink/contract-gen';
import type { AuthoredSchema, ComposedSource } from '@kitchensink/contract-gen';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { z } from 'zod';

import {
    REMOTE_SEARCH_ADAPTER_REVISIONS,
    remoteSearchPath,
    remoteSearchSourceSchema,
} from '../../src/search/remoteSearch.schema.js';
import {
    ALLOWED_PACKAGE_IMPORTS,
    SCHEMA_PACKAGE_NAME,
    SCHEMA_PACKAGE_ROOT,
    SERVICE_PATH_PREFIX,
    SERVICE_ROOT,
    SERVICE_STAMP_PATH,
} from '../config.js';
import { remoteSearchOpenApiDocument } from '../openapi.js';

/** The authored schemas, discovered with the config the generator runs with. */
const authored: AuthoredSchema[] = await discoverAuthoredSchemas(SERVICE_ROOT);

/** The composed sources the authored schemas reach: none, because the allowlist is zod-only (asserted below). */
const composed: readonly ComposedSource[] = await collectComposedSources(authored, { serviceRoot: SERVICE_ROOT });

/** The document's paths, as far as these tests read them. */
const documentPathsSchema = z.record(z.string(), z.record(z.string(), z.object({ security: z.array(z.unknown()) })));

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

describe('the authored remote search wire contract', () => {
    it('contains at least one schema, so the package cannot be silently empty', () => {
        expect(authored.length).toBeGreaterThan(0);
    });

    it('imports nothing but zod and flat sibling schema modules', () => {
        const violations = authored.flatMap((schema) =>
            findViolations(schema.servicePath, schema.source, ALLOWED_PACKAGE_IMPORTS),
        );

        expect(violations).toStrictEqual([]);
    });

    it('allows ONLY zod at the package level, so the copy stays a leaf for food-service', () => {
        expect(ALLOWED_PACKAGE_IMPORTS.map((entry) => entry.specifier)).toStrictEqual(['zod']);
    });

    it('documents a substantive reason for every allowlist entry', () => {
        for (const entry of ALLOWED_PACKAGE_IMPORTS) {
            expect(entry.why.length).toBeGreaterThan(20);
        }
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
            expect(committed).toContain('GENERATED FILE');
        }
    });

    it('exports the zod, the types and the contract hash from the package root', async () => {
        const barrel = await readCommitted('src/schemas.ts');

        for (const schema of authored) {
            expect(barrel).toContain(`export * from './schemas/${schema.moduleName}.js';`);
        }

        expect(await readCommitted('src/index.ts')).toContain("export { CONTRACT_HASH } from './contractHash.js';");
        expect(await readCommitted('src/types.ts')).toContain("export type * from './schemas.js';");
    });

    it('publishes an openapi.yaml identical to a fresh derivation from the authored zod', async () => {
        const committed = await readCommitted('openapi.yaml');

        expect(committed).toContain(stringify(remoteSearchOpenApiDocument.document, { lineWidth: 120 }));
        expect(committed).toContain('NOT the type authority');
    });
});

describe('drift layer 3 — the contract hash', () => {
    const expected = computeContractHash(authored, composed);

    it('reaches no composed source, because the allowlist is zod-only', () => {
        expect(composed).toStrictEqual([]);
    });

    it('is stamped in the schema package as the fingerprint of the authored sources', async () => {
        expect(await readCommitted('src/contractHash.ts')).toContain(`export const CONTRACT_HASH = '${expected}';`);
    });

    it('is stamped identically in the SERVICE', async () => {
        const stamp = await readFile(join(SERVICE_ROOT, SERVICE_STAMP_PATH), 'utf8');

        expect(stamp).toContain(`export const CONTRACT_HASH = '${expected}';`);
    });
});

describe('the leaf property', () => {
    it('declares zod as its ONLY runtime dependency', async () => {
        const manifest = z
            .object({ name: z.string(), dependencies: z.record(z.string(), z.string()) })
            .parse(JSON.parse(await readCommitted('package.json')));

        expect(manifest.name).toBe(SCHEMA_PACKAGE_NAME);
        expect(Object.keys(manifest.dependencies)).toStrictEqual(['zod']);
    });
});

describe('openapi coverage', () => {
    it('leaves NO response body undocumented, and types every operation', () => {
        expect(remoteSearchOpenApiDocument.coverage.responsesWithoutSchema).toStrictEqual([]);
        expect(remoteSearchOpenApiDocument.coverage.operationsFullyTyped).toBe(
            remoteSearchOpenApiDocument.coverage.totalOperations,
        );
    });

    // The document templates the path; the service serves the paths `remoteSearchPath` builds. Both must agree.
    it('documents the one path template every source search fills in', () => {
        const templates = Object.keys(documentPathsSchema.parse(remoteSearchOpenApiDocument.document['paths']));

        expect(templates).toHaveLength(1);

        for (const source of remoteSearchSourceSchema.options) {
            const filled = templates[0]
                ?.replace('{source}', source)
                .replace('{adapterRevision}', String(REMOTE_SEARCH_ADAPTER_REVISIONS[source]));

            expect(filled).toBe(remoteSearchPath(source));
        }
    });

    it('requires the signed URL on every operation', () => {
        const paths = documentPathsSchema.parse(remoteSearchOpenApiDocument.document['paths']);

        for (const operation of Object.values(paths).flatMap((methods) => Object.values(methods))) {
            expect(operation.security).toStrictEqual([{ cloudFrontSignedUrl: [] }]);
        }
    });
});
