/**
 * Unit tests for the import restriction — the load-bearing safety property of the whole schema-package
 * seam, and now the ONE implementation shared by every service.
 *
 * Every case names a specific way a forbidden import can slip past a naive checker (a comment, a string
 * literal, a re-export, a dynamic import, a deep sibling path, a type-only import, a lookalike package
 * name). A checker that passes only the obvious `import { X } from '../dal/y.js'` case would let the real
 * leaks through, so these are written to FAIL if the implementation is shallow.
 *
 * MUTATION LENS. Each assertion below is paired with the specific implementation mutation it kills; see
 * the `describe` preambles. `npm test --workspace=@kitchensink/contract-gen` after deleting any one branch
 * of `findViolations` turns at least one of these red.
 */
import { describe, expect, it } from 'vitest';

import { findViolations, formatViolations, isAllowedSpecifier } from '../schema-imports.js';
import type { AllowedPackageImport } from '../schema-imports.js';

/** The allowlist a food-style service uses: zod only. */
const ZOD_ONLY: readonly AllowedPackageImport[] = [{ specifier: 'zod', why: 'The schema language itself.' }];

/** A recipe-style allowlist: zod plus one audited zod-only domain leaf. */
const WITH_LEAF: readonly AllowedPackageImport[] = [
    ...ZOD_ONLY,
    { specifier: '@kitchensink/recipe-core', why: 'Zod-only leaf that owns the recipe domain schemas.' },
];

describe('isAllowedSpecifier', () => {
    it('allows zod', () => {
        expect(isAllowedSpecifier('zod', ZOD_ONLY)).toBe(true);
    });

    it('allows a flat sibling schema module', () => {
        expect(isAllowedSpecifier('./ratings.schema.js', ZOD_ONLY)).toBe(true);
        expect(isAllowedSpecifier('./search-response.schema.js', ZOD_ONLY)).toBe(true);
    });

    // Generation FLATTENS every schema into one directory, so a deep relative specifier resolves in the
    // service and breaks after the copy. It must be rejected here, where the author can still see why.
    it('rejects a DEEP sibling schema path', () => {
        expect(isAllowedSpecifier('../photos/photos.schema.js', ZOD_ONLY)).toBe(false);
        expect(isAllowedSpecifier('./nested/x.schema.js', ZOD_ONLY)).toBe(false);
    });

    it('rejects a sibling that is not a schema module', () => {
        expect(isAllowedSpecifier('./food.dao.js', ZOD_ONLY)).toBe(false);
        expect(isAllowedSpecifier('./foods.service.js', ZOD_ONLY)).toBe(false);
        expect(isAllowedSpecifier('./foods.types.js', ZOD_ONLY)).toBe(false);
    });

    // A `.ts` sibling specifier is TS5097 under NodeNext AND would not resolve in the emitted package.
    it('rejects a sibling spelled with the .ts extension', () => {
        expect(isAllowedSpecifier('./foods.schema.ts', ZOD_ONLY)).toBe(false);
    });

    it('rejects an extensionless sibling, which does not resolve under NodeNext', () => {
        expect(isAllowedSpecifier('./foods.schema', ZOD_ONLY)).toBe(false);
    });

    it('rejects the service internals that would drag the server graph in', () => {
        for (const specifier of [
            '../foods/dao/index.js',
            '../db/schema/food.js',
            '@nestjs/common',
            'drizzle-orm',
            'pg',
            '@aws-sdk/client-s3',
            'class-validator',
        ]) {
            expect(isAllowedSpecifier(specifier, ZOD_ONLY)).toBe(false);
        }
    });

    // Kills a mutation from exact equality to `startsWith`: a subpath is a DIFFERENT module with different
    // transitive dependencies, so admitting the package must not admit its subpaths.
    it('rejects a subpath of an allowed package', () => {
        expect(isAllowedSpecifier('zod/v4', ZOD_ONLY)).toBe(false);
        expect(isAllowedSpecifier('@kitchensink/recipe-core/database-name', WITH_LEAF)).toBe(false);
    });

    it('rejects a package whose name merely starts with an allowed one', () => {
        expect(isAllowedSpecifier('zod-to-json-schema', ZOD_ONLY)).toBe(false);
        expect(isAllowedSpecifier('@kitchensink/recipe-core-extras', WITH_LEAF)).toBe(false);
    });

    // Kills a mutation that hard-codes the allowlist instead of honouring the caller's: the recipe leaf is
    // admitted for recipe and rejected for a zod-only service, from the SAME function.
    it('honours the caller-supplied allowlist rather than a hard-coded one', () => {
        expect(isAllowedSpecifier('@kitchensink/recipe-core', WITH_LEAF)).toBe(true);
        expect(isAllowedSpecifier('@kitchensink/recipe-core', ZOD_ONLY)).toBe(false);
    });

    it('rejects a bare parent-relative path', () => {
        expect(isAllowedSpecifier('..', ZOD_ONLY)).toBe(false);
        expect(isAllowedSpecifier('../index.js', ZOD_ONLY)).toBe(false);
    });
});

describe('findViolations', () => {
    it('accepts a compliant schema file', () => {
        const source = [
            "import { z } from 'zod';",
            "import { foodStatusSchema } from './food-status.schema.js';",
            'export const s = z.object({ status: foodStatusSchema });',
        ].join('\n');

        expect(findViolations('a.schema.ts', source, ZOD_ONLY)).toStrictEqual([]);
    });

    // `import type` must NOT be exempted: it erases at runtime, but the COPIED file still references a path
    // that does not exist in the leaf package, so the generated package would not compile.
    it('catches a type-only import of a service-internal module', () => {
        const source = "import type { FoodStatus } from './dao/index.js';";

        const violations = findViolations('foods.schema.ts', source, ZOD_ONLY);

        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatchObject({
            specifier: './dao/index.js',
            symbols: ['FoodStatus'],
            line: 1,
        });
    });

    it('catches an inline type-only named import', () => {
        const violations = findViolations('a.schema.ts', "import { type FoodStatus } from './dao/index.js';", ZOD_ONLY);

        expect(violations).toHaveLength(1);
        expect(violations[0]?.symbols).toStrictEqual(['FoodStatus']);
    });

    it('catches a bare side-effect import', () => {
        const violations = findViolations('a.schema.ts', "import 'reflect-metadata';", ZOD_ONLY);

        expect(violations).toHaveLength(1);
        expect(violations[0]?.specifier).toBe('reflect-metadata');
        expect(violations[0]?.symbols).toStrictEqual([]);
    });

    it('catches a re-export, which leaks exactly as effectively as an import', () => {
        const violations = findViolations('a.schema.ts', "export { FoodStatus } from './dao/index.js';", ZOD_ONLY);

        expect(violations).toHaveLength(1);
        expect(violations[0]?.symbols).toStrictEqual(['FoodStatus']);
    });

    it('catches a type-only re-export', () => {
        const violations = findViolations('a.schema.ts', "export type { FoodStatus } from './dao/index.js';", ZOD_ONLY);

        expect(violations).toHaveLength(1);
    });

    it('catches a star re-export', () => {
        const violations = findViolations('a.schema.ts', "export * from '@nestjs/common';", ZOD_ONLY);

        expect(violations).toHaveLength(1);
        expect(violations[0]?.specifier).toBe('@nestjs/common');
    });

    it('catches a namespaced star re-export', () => {
        const violations = findViolations('a.schema.ts', "export * as dao from './dao/index.js';", ZOD_ONLY);

        expect(violations).toHaveLength(1);
        expect(violations[0]?.specifier).toBe('./dao/index.js');
    });

    it('catches a dynamic import with a literal specifier', () => {
        const violations = findViolations('a.schema.ts', "const m = await import('drizzle-orm');", ZOD_ONLY);

        expect(violations).toHaveLength(1);
        expect(violations[0]?.specifier).toBe('drizzle-orm');
    });

    it('catches a dynamic import nested inside a function body', () => {
        const source = ['export async function load() {', "    return import('pg');", '}'].join('\n');

        expect(findViolations('a.schema.ts', source, ZOD_ONLY)).toHaveLength(1);
    });

    it('catches a namespace import and names the alias', () => {
        const violations = findViolations('a.schema.ts', "import * as dao from './dao/index.js';", ZOD_ONLY);

        expect(violations[0]?.symbols).toStrictEqual(['dao']);
    });

    it('catches a default import and names the binding', () => {
        const violations = findViolations('a.schema.ts', "import pg from 'pg';", ZOD_ONLY);

        expect(violations[0]?.symbols).toStrictEqual(['pg']);
    });

    it('names both the default and the named bindings of a mixed import', () => {
        const violations = findViolations('a.schema.ts', "import pg, { Pool } from 'pg';", ZOD_ONLY);

        expect(violations[0]?.symbols).toStrictEqual(['pg', 'Pool']);
    });

    // A regex-based checker fails both of these: it would report imports that are not there.
    it('is not fooled by the word import inside a comment', () => {
        const source = ["// import { X } from './dao/index.js';", "import { z } from 'zod';"].join('\n');

        expect(findViolations('a.schema.ts', source, ZOD_ONLY)).toStrictEqual([]);
    });

    it('is not fooled by an import-like string literal', () => {
        const source = ["import { z } from 'zod';", 'export const doc = "import x from \'@nestjs/common\'";'].join(
            '\n',
        );

        expect(findViolations('a.schema.ts', source, ZOD_ONLY)).toStrictEqual([]);
    });

    it('is not fooled by the identifier `import` inside a template literal', () => {
        const source = ["import { z } from 'zod';", "export const doc = `import pg from 'pg'`;"].join('\n');

        expect(findViolations('a.schema.ts', source, ZOD_ONLY)).toStrictEqual([]);
    });

    // `import.meta` is a MetaProperty, not a call — a checker that treats every ImportKeyword as a dynamic
    // import would crash or mis-report here.
    it('is not fooled by import.meta', () => {
        const source = ["import { z } from 'zod';", 'export const dir = import.meta.dirname;'].join('\n');

        expect(findViolations('a.schema.ts', source, ZOD_ONLY)).toStrictEqual([]);
    });

    it('reports the correct line number for a violation below the first line', () => {
        const source = ["import { z } from 'zod';", '', "import { D } from './food.dao.js';"].join('\n');

        expect(findViolations('a.schema.ts', source, ZOD_ONLY)[0]?.line).toBe(3);
    });

    it('reports every violation in a file, not just the first', () => {
        const source = [
            "import { z } from 'zod';",
            "import { A } from './dao/index.js';",
            "import { B } from 'drizzle-orm';",
        ].join('\n');

        expect(findViolations('a.schema.ts', source, ZOD_ONLY)).toHaveLength(2);
    });

    it('carries the caller-supplied file path into every violation', () => {
        const violations = findViolations('src/foods/foods.schema.ts', "import x from 'pg';", ZOD_ONLY);

        expect(violations[0]?.file).toBe('src/foods/foods.schema.ts');
    });
});

describe('formatViolations', () => {
    it('names the file, line, specifier and symbols so the fix needs no file open', () => {
        const message = formatViolations(
            findViolations('foods.schema.ts', "import type { F } from './dao/index.js';", ZOD_ONLY),
            { allowed: ZOD_ONLY, schemaPackageName: '@kitchensink/schema-food' },
        );

        expect(message).toContain('foods.schema.ts:1');
        expect(message).toContain("'./dao/index.js'");
        expect(message).toContain('(F)');
    });

    it('states the allowlist and the destination package so the reader knows what IS permitted', () => {
        const message = formatViolations(findViolations('a.schema.ts', "import x from 'pg';", WITH_LEAF), {
            allowed: WITH_LEAF,
            schemaPackageName: '@kitchensink/schema-recipe',
        });

        expect(message).toContain("'zod'");
        expect(message).toContain("'@kitchensink/recipe-core'");
        expect(message).toContain('.schema.js');
        expect(message).toContain('@kitchensink/schema-recipe');
    });

    it('reports the violation count', () => {
        const source = ["import a from 'pg';", "import b from 'drizzle-orm';"].join('\n');
        const message = formatViolations(findViolations('a.schema.ts', source, ZOD_ONLY), {
            allowed: ZOD_ONLY,
            schemaPackageName: '@kitchensink/schema-food',
        });

        expect(message).toContain('2 forbidden import(s)');
    });
});
