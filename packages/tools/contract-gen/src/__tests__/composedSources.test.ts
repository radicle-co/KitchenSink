/**
 * Tests for COMPOSED-LEAF REACHABILITY — the corpus that closes drift layer 3's blind spot.
 *
 * The defect these exist to keep fixed, measured on 2026-08-12: `CONTRACT_HASH` hashed only the authored
 * `*.schema.ts` sources, so changing `recipeDetailSchema`'s DEFINITION in `@kitchensink/recipe-core` changed the
 * wire shape (`openapi.yaml` gained a required property) while every authored source stayed byte-identical and
 * the hash did not move. A deployed service and a pinned mobile binary could disagree about `Recipe` with
 * matching stamps.
 *
 * Both directions are asserted, because a hash that moves on everything is as useless as one that moves on
 * nothing: a change to a REACHABLE composed module must move the hash, and a change to an UNREACHABLE module in
 * the very same package must not.
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { collectComposedSources, composedSourceKey } from '../composedSources.js';
import { computeContractHash, discoverAuthoredSchemas } from '../authoredSchema.js';

/** A fixture tree: POSIX-relative path → file contents. */
type Tree = Readonly<Record<string, string>>;

/**
 * Materialise a fixture tree in a fresh temp directory.
 *
 * @param tree - Relative paths to contents.
 * @returns The absolute root the tree was written under.
 * @sideEffect Creates directories and files.
 */
async function writeTree(tree: Tree): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'composed-sources-'));

    for (const [path, contents] of Object.entries(tree)) {
        const full = join(root, path);

        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, contents, 'utf8');
    }

    return root;
}

/**
 * Link a workspace package into a service's `node_modules`, exactly as npm workspaces does.
 *
 * The symlink is what makes the fixture honest: a workspace dependency resolves THROUGH `node_modules` but its
 * real path is the package directory, and that difference is the whole basis of the in-repo test.
 *
 * @param root - The fixture root.
 * @param from - `node_modules`-relative link path, e.g. `svc/node_modules/@x/leaf`.
 * @param to - Fixture-relative target directory, e.g. `leaf`.
 * @sideEffect Creates a directory symlink.
 */
async function linkWorkspace(root: string, from: string, to: string): Promise<void> {
    const link = join(root, from);

    await mkdir(dirname(link), { recursive: true });
    await symlink(join(root, to), link, 'dir');
}

/**
 * An INSTALLED third-party dependency, hoisted to the fixture root so it resolves from both the service and the
 * leaf — exactly as `zod` does in the real tree. It ships declarations only.
 *
 * Present in every fixture on purpose: it is what makes "resolves, but is EXTERNAL" distinguishable from "does not
 * resolve at all". Both are skipped, but for different reasons, and a fixture with no installed dependency at all
 * would let a collector that had stopped resolving anything pass the external-exclusion cases vacuously.
 */
const installedDependency: Tree = {
    'node_modules/zod/package.json': JSON.stringify({ name: 'zod', types: './index.d.ts' }),
    'node_modules/zod/index.d.ts': ['export declare const z: { object: (shape: unknown) => never };', ''].join('\n'),
};

/** The service half of every fixture: one authored schema, whose imports are the thing under test. */
const serviceTree = (schemaSource: string): Tree => ({
    'svc/package.json': JSON.stringify({ name: '@x/svc', type: 'module' }),
    'svc/src/thing.schema.ts': schemaSource,
});

/** A leaf package whose barrel re-exports one reachable module and one that nothing imports. */
const leafTree: Tree = {
    'leaf/package.json': JSON.stringify({
        name: '@x/leaf',
        type: 'module',
        exports: { '.': './src/index.ts' },
    }),
    'leaf/src/index.ts': ["export * from './shapes.js';", "export * from './unrelated.js';", ''].join('\n'),
    'leaf/src/shapes.ts': [
        "import { z } from 'zod';",
        'export const leafSchema = z.object({ a: z.string() });',
        "export const LEAF_CODE = 'LEAF';",
        '',
    ].join('\n'),
    'leaf/src/unrelated.ts': ['export const unrelatedThing = 41;', ''].join('\n'),
};

/**
 * Build the standard fixture: a service authoring one schema that imports from a linked workspace leaf.
 *
 * @param schemaSource - The authored schema's source text.
 * @param extra - Additional files to overlay.
 * @returns The fixture root and the service root within it.
 * @sideEffect Writes a temp tree.
 */
async function fixture(schemaSource: string, extra: Tree = {}): Promise<{ root: string; serviceRoot: string }> {
    const root = await writeTree({ ...installedDependency, ...serviceTree(schemaSource), ...leafTree, ...extra });

    await linkWorkspace(root, 'svc/node_modules/@x/leaf', 'leaf');

    return { root, serviceRoot: join(root, 'svc') };
}

/**
 * Collect the composed corpus for a fixture.
 *
 * @param serviceRoot - The fixture's service root.
 * @returns The composed sources.
 * @sideEffect Reads the fixture tree.
 */
async function collect(serviceRoot: string): ReturnType<typeof collectComposedSources> {
    const authored = await discoverAuthoredSchemas(serviceRoot);

    return collectComposedSources(authored, { serviceRoot });
}

describe('composedSourceKey', () => {
    it('keys a file by package name and package-relative path, never by checkout location', () => {
        expect(composedSourceKey('@x/leaf', 'src/shapes.ts')).toBe('@x/leaf/src/shapes.ts');
    });
});

describe('collectComposedSources', () => {
    it('includes the module that DEFINES an imported symbol, reached through the barrel', async () => {
        const { serviceRoot } = await fixture(
            ["import { leafSchema } from '@x/leaf';", 'export const wire = leafSchema;', ''].join('\n'),
        );

        const keys = (await collect(serviceRoot)).map((source) => source.key);

        // Non-vacuity first: the corpus must exist at all before its contents mean anything.
        expect(keys.length).toBeGreaterThan(0);
        expect(keys).toContain('@x/leaf/src/shapes.ts');
        // The barrel is on the resolution path, so it is part of the corpus too.
        expect(keys).toContain('@x/leaf/src/index.ts');
    });

    it('EXCLUDES a module in the same package that no authored schema reaches', async () => {
        const { serviceRoot } = await fixture(
            ["import { leafSchema } from '@x/leaf';", 'export const wire = leafSchema;', ''].join('\n'),
        );

        const keys = (await collect(serviceRoot)).map((source) => source.key);

        expect(keys).not.toContain('@x/leaf/src/unrelated.ts');
    });

    it('carries the verbatim source text of each reachable module', async () => {
        const { root, serviceRoot } = await fixture(
            ["import { leafSchema } from '@x/leaf';", 'export const wire = leafSchema;', ''].join('\n'),
        );

        const shapes = (await collect(serviceRoot)).find((source) => source.key === '@x/leaf/src/shapes.ts');

        expect(shapes?.source).toBe(await readFile(join(root, 'leaf/src/shapes.ts'), 'utf8'));
    });

    it('follows a re-exported CONSTANT, not only a re-exported schema', async () => {
        const { serviceRoot } = await fixture(
            ["import { LEAF_CODE } from '@x/leaf';", 'export const code = LEAF_CODE;', ''].join('\n'),
        );

        const keys = (await collect(serviceRoot)).map((source) => source.key);

        expect(keys).toContain('@x/leaf/src/shapes.ts');
    });

    it('follows a TYPE-ONLY import, because a type change is a wire change', async () => {
        const { serviceRoot } = await fixture(
            ["import type { Shape } from '@x/leaf';", 'export type Wire = Shape;', ''].join('\n'),
            { 'leaf/src/shapes.ts': ['export interface Shape { a: string }', ''].join('\n') },
        );

        const keys = (await collect(serviceRoot)).map((source) => source.key);

        expect(keys).toContain('@x/leaf/src/shapes.ts');
    });

    it('resolves an ALIASED import by its exported name, not its local alias', async () => {
        const { serviceRoot } = await fixture(
            ["import { leafSchema as renamed } from '@x/leaf';", 'export const wire = renamed;', ''].join('\n'),
        );

        const keys = (await collect(serviceRoot)).map((source) => source.key);

        expect(keys).toContain('@x/leaf/src/shapes.ts');
    });

    it('follows a defining module TRANSITIVELY into what it imports', async () => {
        const { serviceRoot } = await fixture(
            ["import { composed } from '@x/leaf';", 'export const wire = composed;', ''].join('\n'),
            {
                'leaf/src/index.ts': ["export * from './composed.js';", "export * from './unrelated.js';", ''].join(
                    '\n',
                ),
                'leaf/src/composed.ts': [
                    "import { BOUND } from './bounds.js';",
                    'export const composed = BOUND;',
                    '',
                ].join('\n'),
                'leaf/src/bounds.ts': ['export const BOUND = 7;', ''].join('\n'),
            },
        );

        const keys = (await collect(serviceRoot)).map((source) => source.key);

        expect(keys).toContain('@x/leaf/src/composed.ts');
        expect(keys).toContain('@x/leaf/src/bounds.ts');
        expect(keys).not.toContain('@x/leaf/src/unrelated.ts');
    });

    it('follows a NAMED re-export hop to the module that declares the symbol', async () => {
        const { serviceRoot } = await fixture(
            ["import { leafSchema } from '@x/leaf';", 'export const wire = leafSchema;', ''].join('\n'),
            {
                'leaf/src/index.ts': ["export { leafSchema } from './shapes.js';", ''].join('\n'),
            },
        );

        const keys = (await collect(serviceRoot)).map((source) => source.key);

        expect(keys).toContain('@x/leaf/src/shapes.ts');
    });

    it('takes the WHOLE package closure for a namespace import, which names no symbols to narrow by', async () => {
        const { serviceRoot } = await fixture(
            ["import * as leaf from '@x/leaf';", 'export const wire = leaf.leafSchema;', ''].join('\n'),
        );

        const keys = (await collect(serviceRoot)).map((source) => source.key);

        expect(keys).toContain('@x/leaf/src/shapes.ts');
        expect(keys).toContain('@x/leaf/src/unrelated.ts');
    });

    it('does NOT follow a dependency that resolves inside node_modules', async () => {
        const { serviceRoot } = await fixture(
            ["import { vendored } from 'vendor';", 'export const wire = vendored;', ''].join('\n'),
            {
                'svc/node_modules/vendor/package.json': JSON.stringify({
                    name: 'vendor',
                    type: 'module',
                    exports: { '.': './src/index.ts' },
                }),
                'svc/node_modules/vendor/src/index.ts': ['export const vendored = 1;', ''].join('\n'),
            },
        );

        const keys = (await collect(serviceRoot)).map((source) => source.key);

        expect(keys.some((key) => key.startsWith('vendor/'))).toBe(false);
    });

    it('does NOT follow a declaration-only dependency such as a published npm package', async () => {
        const { root, serviceRoot } = await fixture(
            ["import { declared } from '@x/declared';", 'export const wire = declared;', ''].join('\n'),
            {
                'declared/package.json': JSON.stringify({ name: '@x/declared', types: './index.d.ts' }),
                'declared/index.d.ts': ['export declare const declared: number;', ''].join('\n'),
            },
        );

        await linkWorkspace(root, 'svc/node_modules/@x/declared', 'declared');

        const keys = (await collect(serviceRoot)).map((source) => source.key);

        expect(keys.some((key) => key.startsWith('@x/declared/'))).toBe(false);
    });

    it('ignores a relative sibling schema import, which the authored corpus already covers', async () => {
        const { serviceRoot } = await fixture(
            ["import { other } from './other.schema.js';", 'export const wire = other;', ''].join('\n'),
            { 'svc/src/other.schema.ts': ['export const other = 1;', ''].join('\n') },
        );

        expect(await collect(serviceRoot)).toStrictEqual([]);
    });

    it('returns each module ONCE and in key order, however many schemas demand it', async () => {
        const { serviceRoot } = await fixture(
            ["import { leafSchema } from '@x/leaf';", 'export const wire = leafSchema;', ''].join('\n'),
            {
                'svc/src/second.schema.ts': [
                    "import { LEAF_CODE } from '@x/leaf';",
                    'export const code = LEAF_CODE;',
                    '',
                ].join('\n'),
            },
        );

        const keys = (await collect(serviceRoot)).map((source) => source.key);

        expect(keys).toStrictEqual([...keys].sort());
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('produces keys independent of the CHECKOUT PATH, so a doubled repo directory cannot shift them', async () => {
        const schema = ["import { leafSchema } from '@x/leaf';", 'export const wire = leafSchema;', ''].join('\n');
        const first = await fixture(schema);
        // A second, independently-named temp root stands in for a differently-named checkout — including the
        // doubled `…/KitchenSink/KitchenSink` shape that has broken a path-stripping ratchet in this repo before.
        const second = await fixture(schema);

        const keysOf = async (serviceRoot: string): Promise<string[]> =>
            (await collect(serviceRoot)).map((source) => source.key);

        expect(first.root).not.toBe(second.root);
        expect(await keysOf(first.serviceRoot)).toStrictEqual(await keysOf(second.serviceRoot));
    });

    it('yields the same hash from two different checkouts of identical content', async () => {
        const schema = ["import { leafSchema } from '@x/leaf';", 'export const wire = leafSchema;', ''].join('\n');
        const first = await fixture(schema);
        const second = await fixture(schema);

        const hashOf = async (serviceRoot: string): Promise<string> => {
            const authored = await discoverAuthoredSchemas(serviceRoot);

            return computeContractHash(authored, await collectComposedSources(authored, { serviceRoot }));
        };

        expect(await hashOf(first.serviceRoot)).toBe(await hashOf(second.serviceRoot));
    });

    describe('refusals', () => {
        it('THROWS when an imported symbol cannot be attributed to any module', async () => {
            const { serviceRoot } = await fixture(
                ["import { missingSymbol } from '@x/leaf';", 'export const wire = missingSymbol;', ''].join('\n'),
            );

            await expect(collect(serviceRoot)).rejects.toThrow(/missingSymbol/u);
        });

        it('names the package and the authored file in the refusal, so it is fixable without a hunt', async () => {
            const { serviceRoot } = await fixture(
                ["import { missingSymbol } from '@x/leaf';", 'export const wire = missingSymbol;', ''].join('\n'),
            );

            await expect(collect(serviceRoot)).rejects.toThrow(
                /@x\/leaf[\s\S]*src\/thing\.schema\.ts|src\/thing\.schema\.ts[\s\S]*@x\/leaf/u,
            );
        });

        // Deliberately NOT a throw. `tsc` already refuses to compile a service against an unresolvable specifier,
        // so refusing here would duplicate that gate while making fingerprinting depend on a complete install —
        // measured when it broke `generate.test.ts`, whose fixture services import zod with no node_modules.
        // Non-vacuity is asserted instead in each service's own contract test, which knows what MUST be reached.
        it('skips an unresolvable specifier rather than failing the run', async () => {
            const { serviceRoot } = await fixture(
                ["import { thing } from '@x/absent';", 'export const wire = thing;', ''].join('\n'),
            );

            await expect(collect(serviceRoot)).resolves.toStrictEqual([]);
        });
    });
});

describe('computeContractHash with composed leaves — the guard, both directions', () => {
    const schema = ["import { leafSchema } from '@x/leaf';", 'export const wireSchema = leafSchema;', ''].join('\n');

    /**
     * Hash a fixture as the generator does.
     *
     * @param serviceRoot - The fixture's service root.
     * @returns The contract hash and the composed keys it was built from.
     * @sideEffect Reads the fixture tree.
     */
    async function hashFixture(serviceRoot: string): Promise<{ hash: string; keys: string[] }> {
        const authored = await discoverAuthoredSchemas(serviceRoot);
        const composed = await collectComposedSources(authored, { serviceRoot });

        return { hash: computeContractHash(authored, composed), keys: composed.map((source) => source.key) };
    }

    it('MOVES when a reachable composed leaf definition changes', async () => {
        const { root, serviceRoot } = await fixture(schema);
        const before = await hashFixture(serviceRoot);

        // Non-vacuity: the corpus must actually contain the file about to be mutated, or a passing assertion
        // below would prove nothing. This is the assertion whose absence let the original defect survive.
        expect(before.keys).toContain('@x/leaf/src/shapes.ts');

        await writeFile(
            join(root, 'leaf/src/shapes.ts'),
            [
                "import { z } from 'zod';",
                'export const leafSchema = z.object({ a: z.string(), addedWireField: z.number() });',
                "export const LEAF_CODE = 'LEAF';",
                '',
            ].join('\n'),
            'utf8',
        );

        expect((await hashFixture(serviceRoot)).hash).not.toBe(before.hash);
    });

    it('DOES NOT MOVE when an unreachable module in the same package changes', async () => {
        const { root, serviceRoot } = await fixture(schema);
        const before = await hashFixture(serviceRoot);

        // Non-vacuity, the other way round: the file about to be mutated must be genuinely OUTSIDE the corpus,
        // and the corpus must be non-empty — otherwise "the hash did not move" is true for the wrong reason.
        expect(before.keys.length).toBeGreaterThan(0);
        expect(before.keys).not.toContain('@x/leaf/src/unrelated.ts');

        await writeFile(
            join(root, 'leaf/src/unrelated.ts'),
            ['export const unrelatedThing = 999;', ''].join('\n'),
            'utf8',
        );

        expect((await hashFixture(serviceRoot)).hash).toBe(before.hash);
    });

    it('MOVES when the barrel stops re-exporting the symbol from one module and starts from another', async () => {
        const { root, serviceRoot } = await fixture(schema);
        const before = await hashFixture(serviceRoot);

        await writeFile(
            join(root, 'leaf/src/index.ts'),
            ["export * from './moved.js';", "export * from './unrelated.js';", ''].join('\n'),
            'utf8',
        );
        await writeFile(
            join(root, 'leaf/src/moved.ts'),
            ["import { z } from 'zod';", 'export const leafSchema = z.object({ a: z.string() });', ''].join('\n'),
            'utf8',
        );

        const after = await hashFixture(serviceRoot);

        expect(after.keys).toContain('@x/leaf/src/moved.ts');
        expect(after.hash).not.toBe(before.hash);
    });

    it('is unchanged from the authored-only hash when a service composes no leaf at all', async () => {
        // This is what keeps food's and identity's committed stamps still correct: their allowlists are zod-only,
        // so their composed corpus is empty and their hash must be EXACTLY what it was before this change.
        const { serviceRoot } = await fixture(
            ["import { z } from 'zod';", 'export const wireSchema = z.object({ a: z.string() });', ''].join('\n'),
        );
        const authored = await discoverAuthoredSchemas(serviceRoot);
        const composed = await collectComposedSources(authored, { serviceRoot });

        expect(composed).toStrictEqual([]);
        expect(computeContractHash(authored, composed)).toBe(computeContractHash(authored, []));
    });

    it('frames composed entries so a boundary shift between key and source cannot collide', () => {
        const authored = [{ servicePath: 'src/a.schema.ts', moduleName: 'a.schema', source: 'x' }];
        const left = computeContractHash(authored, [
            { key: '@x/leaf/a.ts', packageName: '@x/leaf', packageRelativePath: 'a.ts', source: 'b' },
        ]);
        const right = computeContractHash(authored, [
            { key: '@x/leaf/a.tsb', packageName: '@x/leaf', packageRelativePath: 'a.tsb', source: '' },
        ]);

        expect(left).not.toBe(right);
    });

    it('is insensitive to composed ordering and to CRLF, so a Windows checkout agrees with CI', () => {
        const authored = [{ servicePath: 'src/a.schema.ts', moduleName: 'a.schema', source: 'x' }];
        const one = { key: '@x/l/a.ts', packageName: '@x/l', packageRelativePath: 'a.ts', source: 'a\nb\n' };
        const two = { key: '@x/l/b.ts', packageName: '@x/l', packageRelativePath: 'b.ts', source: 'c\n' };
        const crlf = { ...one, source: 'a\r\nb\r\n' };

        expect(computeContractHash(authored, [one, two])).toBe(computeContractHash(authored, [two, one]));
        expect(computeContractHash(authored, [crlf, two])).toBe(computeContractHash(authored, [one, two]));
    });

    it('distinguishes an authored corpus from a composed corpus carrying the same text', () => {
        const authored = [{ servicePath: 'src/a.schema.ts', moduleName: 'a.schema', source: 'shared' }];
        const withComposed = computeContractHash(authored, [
            { key: '@x/l/a.ts', packageName: '@x/l', packageRelativePath: 'a.ts', source: 'shared' },
        ]);

        expect(withComposed).not.toBe(computeContractHash(authored, []));
    });
});
