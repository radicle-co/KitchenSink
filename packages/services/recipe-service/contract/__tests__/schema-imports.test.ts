/**
 * Unit tests for the import restriction — the seam's load-bearing safety property.
 *
 * Every case names a specific way a forbidden import can slip past a naive checker (a comment, a string
 * literal, a re-export, a dynamic import, a deep sibling path, a type-only import). A checker that passes
 * only the obvious `import { X } from '../dal/y.js'` case would let the real leaks through, so these are
 * written to fail if the implementation is shallow.
 */
import { describe, expect, it } from 'vitest';

import { ALLOWED_PACKAGE_IMPORTS, findViolations, formatViolations, isAllowedSpecifier } from '../schema-imports.js';

describe('isAllowedSpecifier', () => {
    it('allows zod', () => {
        expect(isAllowedSpecifier('zod')).toBe(true);
    });

    it('allows the zod-only recipe-core leaf', () => {
        expect(isAllowedSpecifier('@kitchensink/recipe-core')).toBe(true);
    });

    it('allows a flat sibling schema module', () => {
        expect(isAllowedSpecifier('./ratings.schema.js')).toBe(true);
        expect(isAllowedSpecifier('./search-response.schema.js')).toBe(true);
    });

    // Generation FLATTENS every schema into one directory, so a deep relative specifier resolves in the
    // service and breaks after the copy. It must be rejected here, where the author can still see why.
    it('rejects a DEEP sibling schema path', () => {
        expect(isAllowedSpecifier('../photos/photos.schema.js')).toBe(false);
        expect(isAllowedSpecifier('./nested/x.schema.js')).toBe(false);
    });

    it('rejects a sibling that is not a schema module', () => {
        expect(isAllowedSpecifier('./search.dal.js')).toBe(false);
        expect(isAllowedSpecifier('./recipes.service.js')).toBe(false);
    });

    it('rejects the service internals that would drag the server graph in', () => {
        for (const specifier of [
            '../dal/search.dal.js',
            '../database/schema/recipes.js',
            '@nestjs/common',
            'drizzle-orm',
            'pg',
            '@aws-sdk/client-s3',
        ]) {
            expect(isAllowedSpecifier(specifier)).toBe(false);
        }
    });

    // A subpath of an allowed package is NOT the allowed package: `@kitchensink/recipe-core/database-name`
    // exists and is a different module with different dependencies.
    it('rejects a subpath of an allowed package', () => {
        expect(isAllowedSpecifier('@kitchensink/recipe-core/database-name')).toBe(false);
        expect(isAllowedSpecifier('zod/v4')).toBe(false);
    });

    it('rejects a package whose name merely starts with an allowed one', () => {
        expect(isAllowedSpecifier('zod-to-json-schema')).toBe(false);
        expect(isAllowedSpecifier('@kitchensink/recipe-core-extras')).toBe(false);
    });

    it('documents a reason for every allowlist entry', () => {
        for (const entry of ALLOWED_PACKAGE_IMPORTS) {
            expect(entry.why.length).toBeGreaterThan(20);
        }
    });
});

describe('findViolations', () => {
    it('accepts a compliant schema file', () => {
        const source = [
            "import { z } from 'zod';",
            "import { recipeVisibilitySchema } from '@kitchensink/recipe-core';",
            "import { ratingSchema } from './ratings.schema.js';",
            'export const s = z.object({ v: recipeVisibilitySchema, r: ratingSchema });',
        ].join('\n');

        expect(findViolations('a.schema.ts', source)).toStrictEqual([]);
    });

    // The exact leak that exists in shipped code today, and it is `import type` — which must NOT be
    // exempted: the copied file would reference a path that does not exist in the leaf package.
    it('catches a type-only import of a DAL module', () => {
        const source = "import type { RecipeSearchFacets } from '../dal/search.dal.js';";

        const violations = findViolations('search-response.schema.ts', source);

        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatchObject({
            specifier: '../dal/search.dal.js',
            symbols: ['RecipeSearchFacets'],
            line: 1,
        });
    });

    it('catches a bare side-effect import', () => {
        const violations = findViolations('a.schema.ts', "import 'reflect-metadata';");

        expect(violations).toHaveLength(1);
        expect(violations[0]?.specifier).toBe('reflect-metadata');
        expect(violations[0]?.symbols).toStrictEqual([]);
    });

    it('catches a re-export, which leaks exactly as effectively as an import', () => {
        const violations = findViolations('a.schema.ts', "export { Thing } from '../dal/search.dal.js';");

        expect(violations).toHaveLength(1);
        expect(violations[0]?.symbols).toStrictEqual(['Thing']);
    });

    it('catches a star re-export', () => {
        const violations = findViolations('a.schema.ts', "export * from '@nestjs/common';");

        expect(violations).toHaveLength(1);
        expect(violations[0]?.specifier).toBe('@nestjs/common');
    });

    it('catches a dynamic import with a literal specifier', () => {
        const violations = findViolations('a.schema.ts', "const m = await import('drizzle-orm');");

        expect(violations).toHaveLength(1);
        expect(violations[0]?.specifier).toBe('drizzle-orm');
    });

    it('catches a namespace import and names the alias', () => {
        const violations = findViolations('a.schema.ts', "import * as dal from '../dal/search.dal.js';");

        expect(violations[0]?.symbols).toStrictEqual(['dal']);
    });

    it('catches a default import and names the binding', () => {
        const violations = findViolations('a.schema.ts', "import pg from 'pg';");

        expect(violations[0]?.symbols).toStrictEqual(['pg']);
    });

    // A regex-based checker fails both of these: it would report imports that are not there.
    it('is not fooled by the word import inside a comment', () => {
        const source = ["// import { X } from '../dal/search.dal.js';", "import { z } from 'zod';"].join('\n');

        expect(findViolations('a.schema.ts', source)).toStrictEqual([]);
    });

    it('is not fooled by an import-like string literal', () => {
        const source = ["import { z } from 'zod';", 'export const doc = "import x from \'@nestjs/common\'";'].join(
            '\n',
        );

        expect(findViolations('a.schema.ts', source)).toStrictEqual([]);
    });

    it('reports the correct line number for a violation below the first line', () => {
        const source = ["import { z } from 'zod';", '', "import { D } from './search.dal.js';"].join('\n');

        expect(findViolations('a.schema.ts', source)[0]?.line).toBe(3);
    });

    it('reports every violation in a file, not just the first', () => {
        const source = [
            "import { z } from 'zod';",
            "import { A } from '../dal/a.dal.js';",
            "import { B } from 'drizzle-orm';",
        ].join('\n');

        expect(findViolations('a.schema.ts', source)).toHaveLength(2);
    });
});

describe('formatViolations', () => {
    it('names the file, line, specifier and symbols so the fix needs no file open', () => {
        const message = formatViolations(
            findViolations('search-response.schema.ts', "import type { F } from '../dal/search.dal.js';"),
        );

        expect(message).toContain('search-response.schema.ts:1');
        expect(message).toContain("'../dal/search.dal.js'");
        expect(message).toContain('(F)');
    });

    it('states the allowlist so the reader knows what IS permitted', () => {
        const message = formatViolations(findViolations('a.schema.ts', "import x from 'pg';"));

        expect(message).toContain("'zod'");
        expect(message).toContain("'@kitchensink/recipe-core'");
        expect(message).toContain('.schema.js');
    });
});
