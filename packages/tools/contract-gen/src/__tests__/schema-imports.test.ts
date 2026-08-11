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

import {
    findUnpublishedSiblingImports,
    findViolations,
    formatUnpublishedSiblingImports,
    formatViolations,
    isAllowedSpecifier,
    siblingModuleName,
} from '../schema-imports.js';
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

    // ── THE THREE MEASURED BYPASSES, plus the triple-slash reference nobody had a case for ──
    //
    // Each of these passed the previous implementation, whose only specifier test was `ts.isStringLiteral`.
    // The module's stated safety property is that a `*.schema.ts` cannot reach the server graph; every form
    // below is one metro and webpack resolve statically, so each was a live hole in exactly that property.

    // A no-substitution template literal is as static as a quoted string — bundlers resolve it.
    it('catches a dynamic import whose specifier is a TEMPLATE LITERAL', () => {
        const violations = findViolations('a.schema.ts', 'const m = await import(`drizzle-orm`);', ZOD_ONLY);

        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatchObject({ specifier: 'drizzle-orm', kind: 'dynamic-import', literal: true });
    });

    it('catches a STATIC import whose specifier is a template literal', () => {
        const violations = findViolations('a.schema.ts', 'export * from `@nestjs/common`;', ZOD_ONLY);

        expect(violations).toHaveLength(1);
        expect(violations[0]?.specifier).toBe('@nestjs/common');
    });

    // "Not a string literal" was previously treated as "not an import", which is backwards: a specifier the
    // guard cannot evaluate is precisely the one it must refuse.
    it('REFUSES a concatenated specifier rather than ignoring it', () => {
        const violations = findViolations('a.schema.ts', "const m = await import('dr' + 'izzle-orm');", ZOD_ONLY);

        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatchObject({ literal: false, kind: 'dynamic-import' });
        expect(violations[0]?.specifier).toBe("'dr' + 'izzle-orm'");
    });

    it('REFUSES an identifier specifier, which nothing can resolve statically', () => {
        const source = ["const name = 'pg';", 'const m = await import(name);'].join('\n');
        const violations = findViolations('a.schema.ts', source, ZOD_ONLY);

        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatchObject({ specifier: 'name', literal: false, line: 2 });
    });

    it('REFUSES an INTERPOLATED template specifier, while admitting the literal sibling form', () => {
        const interpolated = findViolations(
            'a.schema.ts',
            'const k = "foods"; const m = await import(`./${k}.schema.js`);',
            ZOD_ONLY,
        );

        expect(interpolated).toHaveLength(1);
        expect(interpolated[0]?.literal).toBe(false);
        expect(findViolations('a.schema.ts', "await import('./foods.schema.js');", ZOD_ONLY)).toStrictEqual([]);
    });

    // The previous docstring justified skipping `require()` with "these files are ESM". True of the SERVICE
    // runtime, false for the copy in the leaf package, which metro and webpack bundle — and both resolve a
    // `require()` statically and pull the module in.
    it('catches a require(), which the copied file is bundled through even though the service is ESM', () => {
        const violations = findViolations('a.schema.ts', "const { sql } = require('drizzle-orm');", ZOD_ONLY);

        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatchObject({ specifier: 'drizzle-orm', kind: 'require' });
    });

    it('catches a require.resolve(), which bundlers also resolve into the bundle', () => {
        const violations = findViolations('a.schema.ts', "const p = require.resolve('pg');", ZOD_ONLY);

        expect(violations).toHaveLength(1);
        expect(violations[0]?.specifier).toBe('pg');
    });

    it('catches a require() of a service-internal module', () => {
        const violations = findViolations('a.schema.ts', "const dao = require('./dao/index.js');", ZOD_ONLY);

        expect(violations).toHaveLength(1);
        expect(violations[0]?.specifier).toBe('./dao/index.js');
    });

    it('allows a require() of an allowlisted package, so the rule stays the allowlist and not the syntax', () => {
        expect(findViolations('a.schema.ts', "const { z } = require('zod');", ZOD_ONLY)).toStrictEqual([]);
    });

    // A triple-slash reference pulls declarations into the compilation: after the copy it either fails to
    // resolve (failure mode 1) or resolves to something else.
    it('catches a /// <reference types="..."> directive', () => {
        const source = ['/// <reference types="drizzle-orm" />', "import { z } from 'zod';"].join('\n');
        const violations = findViolations('a.schema.ts', source, ZOD_ONLY);

        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatchObject({ specifier: 'drizzle-orm', kind: 'type-reference', line: 1 });
    });

    it('catches a /// <reference path="..."> directive into the service tree', () => {
        const source = ['/// <reference path="../dao/index.d.ts" />', "import { z } from 'zod';"].join('\n');
        const violations = findViolations('a.schema.ts', source, ZOD_ONLY);

        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatchObject({ specifier: '../dao/index.d.ts', kind: 'path-reference' });
    });

    // A `lib` reference names a TypeScript library rather than a module, so it cannot fail to resolve after the
    // copy — reporting it would be a false positive.
    it('does NOT report a /// <reference lib="..."> directive, which names no module', () => {
        const source = ['/// <reference lib="es2022" />', "import { z } from 'zod';"].join('\n');

        expect(findViolations('a.schema.ts', source, ZOD_ONLY)).toStrictEqual([]);
    });

    it('reports violations in source order even when a directive and an import are mixed', () => {
        const source = ['/// <reference types="pg" />', "import x from 'drizzle-orm';"].join('\n');

        expect(findViolations('a.schema.ts', source, ZOD_ONLY).map((violation) => violation.line)).toStrictEqual([
            1, 2,
        ]);
    });
});

describe('siblingModuleName', () => {
    it('returns the flat module name a sibling specifier resolves to', () => {
        expect(siblingModuleName('./foods.schema.js')).toBe('foods.schema');
        expect(siblingModuleName('./search-response.schema.js')).toBe('search-response.schema');
    });

    it('returns undefined for anything that is not a flat sibling schema specifier', () => {
        for (const specifier of ['zod', '../foods/foods.schema.js', './foods.dao.js', './foods.schema.ts']) {
            expect(siblingModuleName(specifier)).toBeUndefined();
        }
    });
});

// The gap between "SHAPED like a sibling schema module" and "actually published". `env.schema.ts` is the live
// case: every service excludes it from publication, and the import restriction admits `./env.schema.js`.
describe('findUnpublishedSiblingImports', () => {
    const PUBLISHED = ['foods.schema', 'admin-metrics.schema'];

    it('accepts a sibling import of a module that IS published', () => {
        const source = "import { foodSchema } from './foods.schema.js';";

        expect(findUnpublishedSiblingImports('a.schema.ts', source, PUBLISHED)).toStrictEqual([]);
    });

    it('catches an import of an EXCLUDED sibling, which the leaf package would not contain', () => {
        const source = ["import { z } from 'zod';", "import { env } from './env.schema.js';"].join('\n');
        const unresolved = findUnpublishedSiblingImports('src/foods/foods.schema.ts', source, PUBLISHED);

        expect(unresolved).toStrictEqual([
            {
                file: 'src/foods/foods.schema.ts',
                specifier: './env.schema.js',
                moduleName: 'env.schema',
                line: 2,
            },
        ]);
    });

    it('catches a renamed or deleted sibling', () => {
        const source = "export { x } from './gone.schema.js';";

        expect(findUnpublishedSiblingImports('a.schema.ts', source, PUBLISHED)).toHaveLength(1);
    });

    it('catches it through a dynamic import and a require too, not only a static import', () => {
        for (const source of ["await import('./env.schema.js');", "require('./env.schema.js');"]) {
            expect(findUnpublishedSiblingImports('a.schema.ts', source, PUBLISHED)).toHaveLength(1);
        }
    });

    // Not this specification's job: a package import is the allowlist's business, and reporting it here too
    // would produce two failures for one mistake.
    it('ignores package and deep-relative specifiers, which the allowlist rejects instead', () => {
        const source = ["import { z } from 'zod';", "import { d } from '../photos/photos.schema.js';"].join('\n');

        expect(findUnpublishedSiblingImports('a.schema.ts', source, PUBLISHED)).toStrictEqual([]);
    });
});

describe('formatUnpublishedSiblingImports', () => {
    it('names the file, the line, the module and what the package will actually contain', () => {
        const message = formatUnpublishedSiblingImports(
            findUnpublishedSiblingImports('src/foods/foods.schema.ts', "import { e } from './env.schema.js';", [
                'foods.schema',
            ]),
            { schemaPackageName: '@kitchensink/schema-food', publishedModuleNames: ['foods.schema'] },
        );

        expect(message).toContain('src/foods/foods.schema.ts:1');
        expect(message).toContain("'./env.schema.js'");
        expect(message).toContain('@kitchensink/schema-food will contain: foods.schema.');
        expect(message).toContain('1 sibling schema import(s)');
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

    // A computed specifier has no module name to print, so the message must say what is actually wrong —
    // otherwise the reader is told their import of `'dr' + 'izzle-orm'` is "not on the allowlist" and goes
    // looking for a list entry to add.
    it('explains a COMPUTED specifier instead of pretending it is a module name', () => {
        const message = formatViolations(findViolations('a.schema.ts', "await import('dr' + 'izzle-orm');", ZOD_ONLY), {
            allowed: ZOD_ONLY,
            schemaPackageName: '@kitchensink/schema-food',
        });

        expect(message).toContain('COMPUTED specifier');
        expect(message).toContain('Write a literal.');
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
