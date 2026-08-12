/**
 * Unit tests for discovery and fingerprinting.
 *
 * The discovery cases exercise the properties that make the seam SAFE rather than merely working: a test
 * fixture must never be published, a stale exclusion must fail loudly instead of silently unpublishing a
 * contract, and the fingerprint must be insensitive to traversal order and line endings but sensitive to every
 * byte of the contract itself. Each case names the mutation it kills.
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    basenameWithoutExtension,
    computeContractHash,
    discoverAuthoredSchemas,
    findDuplicateModuleNames,
    flattenSiblingImports,
    isAuthoredSchemaFile,
    isWalkableDirectory,
} from '../authored-schema.js';
import type { AuthoredSchema } from '../authored-schema.js';
import type { ComposedSource } from '../composed-sources.js';

/** Build an {@link AuthoredSchema} for the pure functions, deriving `moduleName` the way discovery does. */
function makeSchema(overrides: Partial<AuthoredSchema> & Pick<AuthoredSchema, 'servicePath'>): AuthoredSchema {
    return {
        moduleName: basenameWithoutExtension(overrides.servicePath),
        source: "import { z } from 'zod';\n",
        ...overrides,
    };
}

/**
 * Materialize a throwaway service tree.
 *
 * @param files - Relative path → contents.
 * @returns The temporary service root.
 * @sideEffect Creates files under the OS temp directory.
 */
async function makeServiceTree(files: Readonly<Record<string, string>>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'contract-gen-'));

    for (const [relativePath, contents] of Object.entries(files)) {
        const absolute = join(root, relativePath);

        await mkdir(join(absolute, '..'), { recursive: true });
        await writeFile(absolute, contents);
    }

    return root;
}

describe('isAuthoredSchemaFile', () => {
    it('accepts a schema module', () => {
        expect(isAuthoredSchemaFile('foods.schema.ts')).toBe(true);
    });

    // A test FOR a schema is not a schema; copying one would publish `vitest` imports to web and mobile.
    it('rejects a schema test', () => {
        expect(isAuthoredSchemaFile('foods.schema.test.ts')).toBe(false);
    });

    it('rejects a declaration file', () => {
        expect(isAuthoredSchemaFile('foods.schema.d.ts')).toBe(false);
    });

    it('rejects anything that is not a schema module', () => {
        for (const name of ['foods.types.ts', 'foods.controller.ts', 'schema.ts', 'foods.schema.js']) {
            expect(isAuthoredSchemaFile(name)).toBe(false);
        }
    });
});

describe('isWalkableDirectory', () => {
    it('skips the directories that hold throwaway schemas and build output', () => {
        for (const name of ['__tests__', '__fixtures__', '__testing__', 'node_modules', 'dist']) {
            expect(isWalkableDirectory(name)).toBe(false);
        }
    });

    it('walks a normal vertical', () => {
        expect(isWalkableDirectory('foods')).toBe(true);
        expect(isWalkableDirectory('dto')).toBe(true);
    });
});

describe('discoverAuthoredSchemas', () => {
    it('finds every schema under src/, sorted by path, with its source text', async () => {
        const root = await makeServiceTree({
            'src/foods/foods.schema.ts': 'export const a = 1;\n',
            'src/health/health.schema.ts': 'export const b = 2;\n',
            'src/foods/foods.controller.ts': 'export class C {}\n',
        });

        const schemas = await discoverAuthoredSchemas(root);

        expect(schemas.map((schema) => schema.servicePath)).toStrictEqual([
            'src/foods/foods.schema.ts',
            'src/health/health.schema.ts',
        ]);
        expect(schemas[0]?.moduleName).toBe('foods.schema');
        expect(schemas[0]?.source).toBe('export const a = 1;\n');
    });

    // A fixture's throwaway schema published as though it were part of the API is a contract that lies.
    it('never publishes a schema that lives under a test or fixture directory', async () => {
        const root = await makeServiceTree({
            'src/foods/foods.schema.ts': 'export const a = 1;\n',
            'src/foods/__tests__/fake.schema.ts': 'export const fake = 1;\n',
            'src/foods/__fixtures__/fake2.schema.ts': 'export const fake2 = 1;\n',
            'src/dist/stale.schema.ts': 'export const stale = 1;\n',
        });

        const schemas = await discoverAuthoredSchemas(root);

        expect(schemas.map((schema) => schema.servicePath)).toStrictEqual(['src/foods/foods.schema.ts']);
    });

    it('omits an excluded file by EXACT path and keeps its siblings', async () => {
        const root = await makeServiceTree({
            'src/config/env.schema.ts': 'export const env = 1;\n',
            'src/config/other.schema.ts': 'export const other = 1;\n',
        });

        const schemas = await discoverAuthoredSchemas(root, {
            excludeFiles: [{ servicePath: 'src/config/env.schema.ts', why: 'Process configuration, not the API.' }],
        });

        expect(schemas.map((schema) => schema.servicePath)).toStrictEqual(['src/config/other.schema.ts']);
    });

    // Kills a mutation from exact-path to prefix matching: a directory-shaped exclusion would silently swallow
    // a future wire schema that happened to live beside the env schema.
    it('does not treat an exclusion as a directory prefix', async () => {
        const root = await makeServiceTree({
            'src/config/env.schema.ts': 'export const env = 1;\n',
            'src/config/nested/wire.schema.ts': 'export const wire = 1;\n',
        });

        const schemas = await discoverAuthoredSchemas(root, {
            excludeFiles: [{ servicePath: 'src/config/env.schema.ts', why: 'Process configuration, not the API.' }],
        });

        expect(schemas.map((schema) => schema.servicePath)).toStrictEqual(['src/config/nested/wire.schema.ts']);
    });

    // A stale exclusion is how a RENAMED schema silently stops being published: the rename makes the exclusion
    // miss, but if a miss were tolerated nothing would say so.
    it('fails loudly when an exclusion names a file that no longer exists', async () => {
        const root = await makeServiceTree({ 'src/foods/foods.schema.ts': 'export const a = 1;\n' });

        await expect(
            discoverAuthoredSchemas(root, {
                excludeFiles: [{ servicePath: 'src/config/env.schema.ts', why: 'gone' }],
            }),
        ).rejects.toThrow(/Stale schema exclusion/u);
    });
});

describe('findDuplicateModuleNames', () => {
    // The generated package is FLAT, so two same-basename files in different verticals would overwrite each
    // other — publishing one contract under the other's name.
    it('reports a basename claimed by two verticals', () => {
        const duplicates = findDuplicateModuleNames([
            makeSchema({ servicePath: 'src/foods/shared.schema.ts' }),
            makeSchema({ servicePath: 'src/admin/shared.schema.ts' }),
        ]);

        expect(duplicates).toStrictEqual(['shared.schema']);
    });

    it('reports each duplicate once even when claimed three times', () => {
        const duplicates = findDuplicateModuleNames([
            makeSchema({ servicePath: 'src/a/x.schema.ts' }),
            makeSchema({ servicePath: 'src/b/x.schema.ts' }),
            makeSchema({ servicePath: 'src/c/x.schema.ts' }),
        ]);

        expect(duplicates).toStrictEqual(['x.schema']);
    });

    it('is empty when every basename is unique', () => {
        expect(
            findDuplicateModuleNames([
                makeSchema({ servicePath: 'src/foods/foods.schema.ts' }),
                makeSchema({ servicePath: 'src/health/health.schema.ts' }),
            ]),
        ).toStrictEqual([]);
    });
});

describe('flattenSiblingImports', () => {
    it('reduces a deep sibling specifier to its flat basename', () => {
        expect(flattenSiblingImports("import { a } from '../foods/foods.schema.js';")).toBe(
            "import { a } from './foods.schema.js';",
        );
    });

    it('leaves an already-flat specifier untouched', () => {
        const source = "import { a } from './foods.schema.js';";

        expect(flattenSiblingImports(source)).toBe(source);
    });

    it('leaves a package specifier untouched', () => {
        const source = "import { z } from 'zod';";

        expect(flattenSiblingImports(source)).toBe(source);
    });
});

describe('computeContractHash', () => {
    /**
     * The authored-only corpus. Every case in this block fixes `composed` to empty so it measures the AUTHORED
     * half alone; the composed half — and the two directions of hash response to a composed leaf — are covered in
     * `./composed-sources.test.ts` against real reachability, which is where they belong.
     */
    const NO_COMPOSED: readonly ComposedSource[] = [];

    const schemas = [
        makeSchema({ servicePath: 'src/a/a.schema.ts', source: 'export const a = 1;\n' }),
        makeSchema({ servicePath: 'src/b/b.schema.ts', source: 'export const b = 2;\n' }),
    ];

    it('is a lower-case hex sha256', () => {
        expect(computeContractHash(schemas, NO_COMPOSED)).toMatch(/^[0-9a-f]{64}$/u);
    });

    it('is insensitive to the order the schemas were discovered in', () => {
        expect(computeContractHash([...schemas].reverse(), NO_COMPOSED)).toBe(
            computeContractHash(schemas, NO_COMPOSED),
        );
    });

    it('is insensitive to CRLF, so a Windows checkout agrees with CI', () => {
        const crlf = [makeSchema({ servicePath: 'src/a/a.schema.ts', source: 'export const a = 1;\r\n' })];
        const lf = [makeSchema({ servicePath: 'src/a/a.schema.ts', source: 'export const a = 1;\n' })];

        expect(computeContractHash(crlf, NO_COMPOSED)).toBe(computeContractHash(lf, NO_COMPOSED));
    });

    it('changes when a schema body changes', () => {
        const mutated = [
            schemas[0]!,
            makeSchema({ servicePath: 'src/b/b.schema.ts', source: 'export const b = 3;\n' }),
        ];

        expect(computeContractHash(mutated, NO_COMPOSED)).not.toBe(computeContractHash(schemas, NO_COMPOSED));
    });

    it('changes when a schema is added', () => {
        const added = [...schemas, makeSchema({ servicePath: 'src/c/c.schema.ts', source: 'export const c = 3;\n' })];

        expect(computeContractHash(added, NO_COMPOSED)).not.toBe(computeContractHash(schemas, NO_COMPOSED));
    });

    it('changes when a schema is renamed but its body is identical', () => {
        const renamed = [
            schemas[0]!,
            makeSchema({ servicePath: 'src/b/renamed.schema.ts', source: 'export const b = 2;\n' }),
        ];

        expect(computeContractHash(renamed, NO_COMPOSED)).not.toBe(computeContractHash(schemas, NO_COMPOSED));
    });

    // Kills a mutation from NUL-framing to plain concatenation. Without a delimiter, the boundary between a
    // path and its body can SHIFT between two corpora whose text concatenates identically, so two genuinely
    // different contracts would fingerprint the same — and drift layer 3 would then certify skew as agreement.
    it('does not collide when the boundary between a path and its body shifts', () => {
        const left = [makeSchema({ servicePath: 'a', source: 'b' })];
        const right = [makeSchema({ servicePath: 'ab', source: '' })];

        expect(computeContractHash(left, NO_COMPOSED)).not.toBe(computeContractHash(right, NO_COMPOSED));
    });

    it('does not collide when the boundary between two schemas shifts', () => {
        const left = [makeSchema({ servicePath: 'a', source: 'b' }), makeSchema({ servicePath: 'c', source: 'd' })];
        const right = [makeSchema({ servicePath: 'ab', source: '' }), makeSchema({ servicePath: 'cd', source: '' })];

        expect(computeContractHash(left, NO_COMPOSED)).not.toBe(computeContractHash(right, NO_COMPOSED));
    });

    it('is empty-corpus stable rather than throwing', () => {
        expect(computeContractHash([], NO_COMPOSED)).toMatch(/^[0-9a-f]{64}$/u);
    });
});
