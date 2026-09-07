/**
 * Tests for the generator itself, driven against a REAL throwaway service tree in a temp directory.
 *
 * The filesystem is not mocked on purpose: `generateSchemaPackage`'s whole job is what ends up on disk, and a
 * mocked `fs` would assert that the right calls were made rather than that the right package was produced —
 * which is exactly the class of test that stays green while the output is wrong.
 *
 * The cases are the seam's safety properties:
 *  - a forbidden import FAILS and leaves the previously-committed package untouched (no half-write),
 *  - a DELETED authored schema disappears from the package (drift in the opposite direction),
 *  - the same `CONTRACT_HASH` lands in BOTH the service and the leaf (drift layer 3 needs both, or the boot
 *    assertion compares a value against itself),
 *  - regeneration is byte-idempotent, which is what makes CI's regenerate-and-diff gate meaningful,
 *  - the published-contract fingerprint is derived from the bytes that were just published, and is
 *    re-derived on EVERY run rather than served from Node's ESM module cache.
 */
import { mkdir, readFile, readdir, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { CONTRACT_FINGERPRINT_FILENAME, type ContractFingerprint } from '../contractFingerprint.js';
import { buildOpenApiDocument } from '../openapi.js';
import { formatGenerationSummary, generateSchemaPackage } from '../generate.js';
import type { ContractGenerationConfig } from '../generate.js';

const COMPLIANT_SCHEMA = [
    "import { z } from 'zod';",
    '',
    'export const widgetSchema = z.object({ id: z.string() });',
    '',
].join('\n');

/** A trivial but valid OpenAPI build result, so the tests vary only the schema sources. */
function makeOpenApi(): ReturnType<typeof buildOpenApiDocument> {
    return buildOpenApiDocument({
        title: 'Widget API',
        version: '1.0.0',
        description: 'Widgets.',
        servers: [{ url: 'https://widgets.example', description: 'production' }],
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
        defaultSecurity: ['bearer'],
        components: { Widget: z.object({ id: z.string() }) },
        paths: {
            '/widgets': {
                get: {
                    operationId: 'listWidgets',
                    summary: 'List widgets',
                    responses: { '200': { description: 'ok', schema: 'Widget' } },
                },
            },
        },
    });
}

/** A temp service root + schema package root, plus a config wiring them together. */
interface Harness {
    readonly serviceRoot: string;
    readonly schemaPackageRoot: string;
    readonly config: ContractGenerationConfig;
}

/**
 * Materialize a throwaway service and its (empty) schema package.
 *
 * @returns The harness.
 * @sideEffect Creates directories under the OS temp directory.
 */
async function makeHarness(): Promise<Harness> {
    const root = await mkdtemp(join(tmpdir(), 'contract-gen-generate-'));
    const serviceRoot = join(root, 'service');
    const schemaPackageRoot = join(root, 'schema');

    await mkdir(join(serviceRoot, 'src', 'widgets'), { recursive: true });
    await mkdir(schemaPackageRoot, { recursive: true });

    return {
        serviceRoot,
        schemaPackageRoot,
        config: {
            serviceRoot,
            schemaPackageRoot,
            schemaPackageName: '@kitchensink/schema-widget',
            servicePathPrefix: 'packages/services/widget-service',
            regenerateCommand: 'npm run contract:generate --workspace=@kitchensink/widget-service',
            contractDisplayName: 'widget service',
            allowedPackageImports: [{ specifier: 'zod', why: 'The schema language itself.' }],
            serviceStampPath: 'src/contract/contractHash.ts',
            openApi: makeOpenApi(),
        },
    };
}

/**
 * Read a generated file.
 *
 * @param harness - The harness.
 * @param relativePath - Path relative to the schema package root.
 * @returns The file's text.
 * @sideEffect Reads the filesystem.
 */
async function readGenerated(harness: Harness, relativePath: string): Promise<string> {
    return readFile(join(harness.schemaPackageRoot, relativePath), 'utf8');
}

describe('generateSchemaPackage', () => {
    let harness: Harness;

    beforeEach(async () => {
        harness = await makeHarness();
        await writeFile(join(harness.serviceRoot, 'src/widgets/widgets.schema.ts'), COMPLIANT_SCHEMA);
    });

    it('copies each authored schema verbatim under a banner naming its source', async () => {
        await generateSchemaPackage(harness.config);

        const copied = await readGenerated(harness, 'src/schemas/widgets.schema.ts');

        expect(copied).toContain('⚠️ GENERATED FILE — DO NOT EDIT.');
        expect(copied).toContain('// Source: packages/services/widget-service/src/widgets/widgets.schema.ts');
        expect(copied).toContain('npm run contract:generate --workspace=@kitchensink/widget-service');
        expect(copied.endsWith(COMPLIANT_SCHEMA)).toBe(true);
    });

    it('writes the barrel, the schemas index, the type re-export and the openapi document', async () => {
        await generateSchemaPackage(harness.config);

        expect(await readGenerated(harness, 'src/schemas.ts')).toContain(
            "export * from './schemas/widgets.schema.js';",
        );
        expect(await readGenerated(harness, 'src/types.ts')).toContain("export type * from './schemas.js';");
        expect(await readGenerated(harness, 'src/index.ts')).toContain("export * from './schemas.js';");
        expect(await readGenerated(harness, 'src/index.ts')).toContain(
            "export { CONTRACT_HASH } from './contractHash.js';",
        );
        expect(await readGenerated(harness, 'openapi.yaml')).toContain('openapi: 3.0.3');
    });

    it('marks openapi.yaml as generated and states it is not the type authority', async () => {
        await generateSchemaPackage(harness.config);
        const document = await readGenerated(harness, 'openapi.yaml');

        expect(document).toContain('GENERATED FILE — DO NOT EDIT');
        expect(document).toContain('NOT the type authority');
    });

    // Drift layer 3 needs the value on BOTH sides; a stamp written to only one side turns the boot assertion
    // into a comparison of a value with itself, which can never fail.
    it('stamps the SAME contract hash into the service and the schema package', async () => {
        const result = await generateSchemaPackage(harness.config);

        const leaf = await readGenerated(harness, 'src/contractHash.ts');
        const service = await readFile(join(harness.serviceRoot, 'src/contract/contractHash.ts'), 'utf8');

        expect(leaf).toContain(`export const CONTRACT_HASH = '${result.contractHash}';`);
        expect(service).toContain(`export const CONTRACT_HASH = '${result.contractHash}';`);
        expect(leaf).toContain('schema package copy');
        expect(service).toContain('service-embedded copy');
    });

    it('changes the contract hash when an authored schema changes', async () => {
        const before = await generateSchemaPackage(harness.config);

        await writeFile(
            join(harness.serviceRoot, 'src/widgets/widgets.schema.ts'),
            `${COMPLIANT_SCHEMA}export const extra = z.object({ n: z.number() });\n`,
        );

        const after = await generateSchemaPackage(harness.config);

        expect(after.contractHash).not.toBe(before.contractHash);
    });

    // Regenerate-and-diff is the strong correctness gate (§15.2.5). It only means anything if a no-change
    // regeneration is byte-identical.
    it('is byte-idempotent, which is what makes CI regenerate-and-diff meaningful', async () => {
        await generateSchemaPackage(harness.config);
        const first = await Promise.all(
            [
                'src/schemas/widgets.schema.ts',
                'src/schemas.ts',
                'src/index.ts',
                'src/contractHash.ts',
                'openapi.yaml',
                CONTRACT_FINGERPRINT_FILENAME,
            ].map((path) => readGenerated(harness, path)),
        );

        await generateSchemaPackage(harness.config);
        const second = await Promise.all(
            [
                'src/schemas/widgets.schema.ts',
                'src/schemas.ts',
                'src/index.ts',
                'src/contractHash.ts',
                'openapi.yaml',
                CONTRACT_FINGERPRINT_FILENAME,
            ].map((path) => readGenerated(harness, path)),
        );

        expect(second).toStrictEqual(first);
    });

    // Without the pre-generation rm, the leaf would keep publishing a shape the service no longer serves.
    it('removes a schema module the service has deleted', async () => {
        await writeFile(
            join(harness.serviceRoot, 'src/widgets/gadgets.schema.ts'),
            COMPLIANT_SCHEMA.replace('widget', 'gadget'),
        );
        await generateSchemaPackage(harness.config);

        expect(await readdir(join(harness.schemaPackageRoot, 'src/schemas'))).toHaveLength(2);

        await rm(join(harness.serviceRoot, 'src/widgets/gadgets.schema.ts'));
        await generateSchemaPackage(harness.config);

        expect(await readdir(join(harness.schemaPackageRoot, 'src/schemas'))).toStrictEqual(['widgets.schema.ts']);
        expect(await readGenerated(harness, 'src/schemas.ts')).not.toContain('gadgets');
    });

    it('honours an exclusion so a non-contract schema is never published', async () => {
        await mkdir(join(harness.serviceRoot, 'src/config'), { recursive: true });
        await writeFile(join(harness.serviceRoot, 'src/config/env.schema.ts'), COMPLIANT_SCHEMA);

        await generateSchemaPackage({
            ...harness.config,
            excludeFiles: [{ servicePath: 'src/config/env.schema.ts', why: 'Process configuration, not the API.' }],
        });

        expect(await readdir(join(harness.schemaPackageRoot, 'src/schemas'))).toStrictEqual(['widgets.schema.ts']);
    });

    describe('the published-contract fingerprint', () => {
        /**
         * Read and parse the generated fingerprint.
         *
         * @returns The parsed document.
         * @sideEffect Reads the filesystem.
         */
        async function readFingerprint(): Promise<ContractFingerprint> {
            return JSON.parse(await readGenerated(harness, CONTRACT_FINGERPRINT_FILENAME)) as ContractFingerprint;
        }

        it('projects every published zod export into contract.schema.json', async () => {
            await generateSchemaPackage(harness.config);

            const fingerprint = await readFingerprint();

            expect(Object.keys(fingerprint.schemas)).toStrictEqual(['widgetSchema']);
            expect(fingerprint.schemas['widgetSchema']).toMatchObject({
                type: 'object',
                properties: { id: { type: 'string' } },
            });
            expect(fingerprint.contract).toBe('@kitchensink/schema-widget');
            expect(fingerprint.regenerate).toBe(harness.config.regenerateCommand);
        });

        it('marks it generated and says, in the file, that it generates nothing', async () => {
            await generateSchemaPackage(harness.config);

            const fingerprint = await readFingerprint();

            expect(fingerprint.$comment).toContain('DO NOT EDIT');
            expect(fingerprint.notCodegen).toMatch(/generates nothing/iu);
            expect(fingerprint.blindTo).toMatch(/refine/u);
        });

        // ⛔ THE ESM-CACHE TRAP. Node keys its module cache by URL and cannot invalidate it, so deriving the
        // fingerprint by importing the committed `src/schemas.ts` would fingerprint whatever that path held the
        // FIRST time this process imported it. Two generations in one process is exactly the shape that would
        // expose it, and this is the test that fails if the throwaway-copy import is ever "simplified" away.
        it('re-derives the fingerprint from the CURRENT sources on a second generation in the same process', async () => {
            await writeFile(
                join(harness.serviceRoot, 'src/widgets/gadgets.schema.ts'),
                COMPLIANT_SCHEMA.replace(/widget/gu, 'gadget'),
            );
            await generateSchemaPackage(harness.config);

            expect(Object.keys((await readFingerprint()).schemas).sort()).toStrictEqual([
                'gadgetSchema',
                'widgetSchema',
            ]);

            await rm(join(harness.serviceRoot, 'src/widgets/gadgets.schema.ts'));
            await generateSchemaPackage(harness.config);

            expect(Object.keys((await readFingerprint()).schemas)).toStrictEqual(['widgetSchema']);
        });

        it('picks up a CHANGED shape on a second generation in the same process', async () => {
            await generateSchemaPackage(harness.config);

            await writeFile(
                join(harness.serviceRoot, 'src/widgets/widgets.schema.ts'),
                "import { z } from 'zod';\n\nexport const widgetSchema = z.object({ id: z.string().max(4) });\n",
            );
            await generateSchemaPackage(harness.config);

            expect((await readFingerprint()).schemas['widgetSchema']).toMatchObject({
                properties: { id: { maxLength: 4 } },
            });
        });

        // The throwaway copy lives inside the schema package so that its imports resolve. If it survived, the
        // drift gate would report it as an uncommitted generator output on every run.
        it('leaves no throwaway import directory behind', async () => {
            await generateSchemaPackage(harness.config);

            expect((await readdir(harness.schemaPackageRoot)).sort()).toStrictEqual([
                'contract.schema.json',
                'openapi.yaml',
                'src',
            ]);
        });

        it('reports how many schemas were fingerprinted, so a silent collapse to zero is visible', async () => {
            const result = await generateSchemaPackage(harness.config);

            expect(result.fingerprintedSchemas).toBe(1);
            expect(formatGenerationSummary(result, '@kitchensink/schema-widget')).toContain(
                'contract.schema.json — 1 schema(s)',
            );
        });
    });

    describe('refusals', () => {
        it('refuses to publish a schema that imports a service internal, naming file and symbol', async () => {
            await writeFile(
                join(harness.serviceRoot, 'src/widgets/widgets.schema.ts'),
                [
                    "import { z } from 'zod';",
                    "import type { Row } from '../db/schema.js';",
                    'export const s = z.object({});',
                ].join('\n'),
            );

            await expect(generateSchemaPackage(harness.config)).rejects.toThrow(/forbidden import/u);
            await expect(generateSchemaPackage(harness.config)).rejects.toThrow(/Row/u);
        });

        // A failed run must leave the COMMITTED package intact: a half-rewritten package that then fails
        // typecheck sends the author hunting a compile error instead of reading the real message.
        it('leaves the previously generated package untouched when the guard fails', async () => {
            await generateSchemaPackage(harness.config);
            const before = await readGenerated(harness, 'src/schemas/widgets.schema.ts');

            await writeFile(
                join(harness.serviceRoot, 'src/widgets/widgets.schema.ts'),
                "import pg from 'pg';\nexport const s = pg;\n",
            );

            await expect(generateSchemaPackage(harness.config)).rejects.toThrow(/forbidden import/u);
            expect(await readGenerated(harness, 'src/schemas/widgets.schema.ts')).toBe(before);
        });

        // Publishing an empty contract is worse than failing: every consumer compiles successfully while
        // believing the API has no shapes.
        it('refuses to publish an empty contract', async () => {
            await rm(join(harness.serviceRoot, 'src/widgets/widgets.schema.ts'));

            await expect(generateSchemaPackage(harness.config)).rejects.toThrow(/EMPTY contract/u);
        });

        it('refuses two authored schemas that claim the same flat module name', async () => {
            await mkdir(join(harness.serviceRoot, 'src/admin'), { recursive: true });
            await writeFile(join(harness.serviceRoot, 'src/admin/widgets.schema.ts'), COMPLIANT_SCHEMA);

            await expect(generateSchemaPackage(harness.config)).rejects.toThrow(/Duplicate schema module name/u);
        });

        // THE HOLE BETWEEN THE TWO CHECKS. `./env.schema.js` is SHAPED like a flat sibling schema module, so the
        // import restriction admits it — while every service excludes `src/config/env.schema.ts` from
        // publication. Without this check generation succeeded and the leaf package shipped an import of a file
        // that is not in it, which is failure mode 1 of the seam, reached through the guard that exists to
        // prevent it.
        it('refuses a sibling import of an EXCLUDED schema, which the leaf package would not contain', async () => {
            await mkdir(join(harness.serviceRoot, 'src/config'), { recursive: true });
            await writeFile(
                join(harness.serviceRoot, 'src/config/env.schema.ts'),
                "import { z } from 'zod';\nexport const envSchema = z.object({ PORT: z.string() });\n",
            );
            await writeFile(
                join(harness.serviceRoot, 'src/widgets/widgets.schema.ts'),
                [
                    "import { z } from 'zod';",
                    "import { envSchema } from './env.schema.js';",
                    'export const s = z.object({ env: envSchema });',
                ].join('\n'),
            );

            const config: ContractGenerationConfig = {
                ...harness.config,
                excludeFiles: [{ servicePath: 'src/config/env.schema.ts', why: 'Process configuration, not wire.' }],
            };

            await expect(generateSchemaPackage(config)).rejects.toThrow(/NOT published/u);
            await expect(generateSchemaPackage(config)).rejects.toThrow(/env\.schema/u);
        });

        it('refuses a sibling import of a schema that does not exist at all', async () => {
            await writeFile(
                join(harness.serviceRoot, 'src/widgets/widgets.schema.ts'),
                [
                    "import { z } from 'zod';",
                    "import { gone } from './renamed.schema.js';",
                    'export const s = z.object({ gone });',
                ].join('\n'),
            );

            await expect(generateSchemaPackage(harness.config)).rejects.toThrow(/NOT published/u);
        });

        it('accepts a sibling import of a schema that IS published', async () => {
            await writeFile(
                join(harness.serviceRoot, 'src/widgets/parts.schema.ts'),
                "import { z } from 'zod';\nexport const partSchema = z.string();\n",
            );
            await writeFile(
                join(harness.serviceRoot, 'src/widgets/widgets.schema.ts'),
                [
                    "import { z } from 'zod';",
                    "import { partSchema } from './parts.schema.js';",
                    'export const s = z.object({ part: partSchema });',
                ].join('\n'),
            );

            await expect(generateSchemaPackage(harness.config)).resolves.toBeDefined();
        });

        // Same no-half-write property as the forbidden-import guard: this check has to run BEFORE the writes,
        // not after, or a failed run leaves the committed package half-rewritten.
        it('leaves the previously generated package untouched when a sibling does not resolve', async () => {
            await generateSchemaPackage(harness.config);
            const before = await readGenerated(harness, 'src/schemas/widgets.schema.ts');

            await writeFile(
                join(harness.serviceRoot, 'src/widgets/widgets.schema.ts'),
                "import { g } from './gone.schema.js';\nexport const s = g;\n",
            );

            await expect(generateSchemaPackage(harness.config)).rejects.toThrow(/NOT published/u);
            expect(await readGenerated(harness, 'src/schemas/widgets.schema.ts')).toBe(before);
        });
    });
});

describe('formatGenerationSummary', () => {
    it('reports the module count, the hash prefix and the coverage', () => {
        const summary = formatGenerationSummary(
            {
                schemas: [{ servicePath: 'src/widgets/widgets.schema.ts', moduleName: 'widgets.schema', source: '' }],
                composed: [],
                contractHash: 'abcdef0123456789',
                fingerprintedSchemas: 7,
                coverage: {
                    totalOperations: 3,
                    operationsFullyTyped: 3,
                    responsesWithoutSchema: [],
                    componentCount: 4,
                },
            },
            '@kitchensink/schema-widget',
        );

        expect(summary).toContain('@kitchensink/schema-widget');
        expect(summary).toContain('src/widgets/widgets.schema.ts');
        expect(summary).toContain('abcdef012345');
        expect(summary).toContain('3/3 fully typed');
        expect(summary).toContain('contract.schema.json — 7 schema(s)');
        expect(summary).not.toContain('⚠️');
    });

    // A gap nobody sees is a gap nobody closes, so the summary must surface it on every run.
    it('surfaces every response that has no body schema', () => {
        const summary = formatGenerationSummary(
            {
                schemas: [{ servicePath: 'src/a/a.schema.ts', moduleName: 'a.schema', source: '' }],
                composed: [],
                contractHash: '0'.repeat(64),
                fingerprintedSchemas: 2,
                coverage: {
                    totalOperations: 2,
                    operationsFullyTyped: 1,
                    responsesWithoutSchema: ['getThing 500'],
                    componentCount: 1,
                },
            },
            '@kitchensink/schema-widget',
        );

        expect(summary).toContain('1 response(s) with NO body schema');
        expect(summary).toContain('getThing 500');
    });
});
