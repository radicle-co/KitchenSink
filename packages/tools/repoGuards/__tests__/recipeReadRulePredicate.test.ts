/**
 * ADR-0105: the read rule's hold lives in ONE place. A recipe is readable by a non-owner only through the shared predicates
 * (`recipePredicates.ts`, `recipeVisibility.ts`), which call the database function `recipe_held_from_readers`. A service file
 * that compares a recipe's visibility anywhere else is a second copy of the rule, and a read that forgets the hold leaks a
 * recipe the cook was told is hidden.
 *
 * ## The rules
 *
 * - Every non-test `.ts` under `recipe-service/src` and `recipe-workers/src` is scanned, whether or not it imports the
 *   `recipes` table: recipe-workers reads through raw `sql` and never imports it.
 * - A visibility comparison fires (`recipeVisibilityReads.ts` lists the forms). A file may hold one only if it is in
 *   {@link ALLOWLIST}, each entry with its reason, and then every SITE (`file#function`) holds its count EXACTLY in
 *   `recipeReadRuleBaseline.json`. A write check removed in one method and a read added in another fails even when the file
 *   total is equal. Any change to a count updates the baseline in the same PR, where a reviewer sees it.
 * - A boolean literal given to `heldFromReaders` fails anywhere in non-test code; `__fixtures__`, `__tests__` and `tests` are test
 *   code, and no non-test file may import from a `__fixtures__` path.
 * - The erasure worker must contain `recipe_held_from_readers`, because its kept set is a raw SQL statement this scan cannot
 *   follow into the database.
 *
 * ✅ THE FIX FOR A FAILURE: read through `readableBy`, `viewableBy`, `communityOf` or `isRecipeViewableBy`. A genuine WRITE
 * check or another entity's visibility goes in the allowlist with its reason, and the baseline records its sites.
 *
 * Limit, stated: the guard fails a comparison it can see. A read with no visibility predicate at all is caught only by the
 * per-path truth-table e2e (`heldFromReaders.e2e.test.ts`).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { fixtureImportsOf, visibilitySitesOf, type VisibilitySite } from './recipeVisibilityReads.js';
import { isTestFile, presentFiles, repoRoot } from './serviceSources.js';

const SCOPES = ['packages/services/recipe-service/src', 'packages/services/recipe-workers/src'] as const;
const BASELINE_PATH = 'packages/tools/repoGuards/__tests__/recipeReadRuleBaseline.json';
const PREDICATES = 'packages/services/recipe-service/src/recipes/dal/recipePredicates.ts';
const VIEWABLE = 'packages/services/recipe-service/src/recipes/domain/recipeVisibility.ts';
const ERASURE = 'packages/services/recipe-workers/src/handlers/accountErasureWorker.ts';
const SVC = 'packages/services/recipe-service/src/';

/** Files that may compare a visibility, each with the reason. Not an exemption from the count: see the baseline. */
const ALLOWLIST: Readonly<Record<string, string>> = {
    [PREDICATES]: 'the shared SQL predicates: the one place the read rule is written in SQL',
    [VIEWABLE]: 'the shared in-memory predicate: the one place the read rule is written in TypeScript',
    [ERASURE]: 'account erasure removes the owner-only set; it must call recipe_held_from_readers (checked below)',
    [`${SVC}database/schema/recipes.ts`]: 'the recipes table definition: its CHECK constraints',
    [`${SVC}database/schema/collections.ts`]: 'the collections table definition: a collection has its own visibility',
    [`${SVC}database/schema/recipeImports.ts`]: 'the import tables definition: an import item has its own visibility',
    [`${SVC}collections/collections.errors.ts`]: 'collection visibility, not a recipe read',
    [`${SVC}collections/collections.service.ts`]: 'collection visibility and its publish check, not a recipe read',
    [`${SVC}ingredients/foodCatalog.gateway.ts`]: 'a FOOD entry has its own visibility',
    [`${SVC}ingredients/foodRefs.gateway.ts`]: 'a FOOD entry has its own visibility',
    [`${SVC}ingredients/resolution/lexicalTier.ts`]: 'a FOOD entry has its own visibility',
    [`${SVC}recipes/dal/privateSlots.dal.ts`]: 'private-slot counting: a write rule of the owner, not a read',
    [`${SVC}recipes/dal/sourceCorrections.dal.ts`]: 'staff hold of the owner’s clones: a write, not a read',
    [`${SVC}recipes/domain/privateSlotPolicy.ts`]: 'private-slot write policy',
    [`${SVC}recipes/domain/publicFoodsPolicy.ts`]: 'publish policy: whether a public recipe may hold a private food',
    [`${SVC}recipes/domain/statementAttestation.ts`]: 'publish policy: when a public confirmation is owed',
    [`${SVC}recipes/domain/visibilityPolicy.ts`]: 'write policy: which visibility a recipe may hold',
    [`${SVC}recipes/recipes.service.ts`]:
        'write checks (setVisibility, private-food link check); reads go through the predicates',
};

type SiteCounts = Readonly<Record<string, number>>;

function countsOf(sites: readonly VisibilitySite[]): SiteCounts {
    const counts: Record<string, number> = {};

    for (const { site } of sites) {
        counts[site] = (counts[site] ?? 0) + 1;
    }

    return counts;
}

/**
 * Every difference between the sites found and the sites recorded: a site above its count (or new), and a recorded site
 * below it (stale). Equality is the rule, so a change in either direction updates the baseline. Pure.
 */
function baselineDifferences(actual: SiteCounts, recorded: SiteCounts): string[] {
    const keys = new Set([...Object.keys(actual), ...Object.keys(recorded)]);

    return [...keys]
        .filter((key) => (actual[key] ?? 0) !== (recorded[key] ?? 0))
        .sort()
        .map((key) => `${key}: found ${actual[key] ?? 0}, recorded ${recorded[key] ?? 0}`);
}

const formsOf = (file: string, source: string): string[] => visibilitySitesOf(file, source).map((site) => site.form);

describe('the detector: one red fixture per comparison form', () => {
    it.each([
        ['=== on a property', "const a = row.visibility === 'public';", 'comparison'],
        ['!== on a property', "const a = row.visibility !== 'private';", 'comparison'],
        ['== on a property', "const a = row.visibility == 'public';", 'comparison'],
        ['!= on a property', "const a = row.visibility != 'public';", 'comparison'],
        ['value on the left', "const a = 'public' === row.visibility;", 'comparison'],
        ['a destructured visibility', "const { visibility } = row; const a = visibility === 'public';", 'comparison'],
        ['an element access', "const a = row['visibility'] === 'public';", 'comparison'],
        ['RecipeVisibility.PUBLIC', 'const a = row.visibility === RecipeVisibility.PUBLIC;', 'comparison'],
        ['RecipeVisibility.PRIVATE', 'const a = row.visibility !== RecipeVisibility.PRIVATE;', 'comparison'],
        [
            'an imported constant',
            'import { VISIBILITY_PUBLIC } from "x"; const a = row.visibility === VISIBILITY_PUBLIC;',
            'comparison',
        ],
        ['a switch', "switch (row.visibility) { case 'public': break; }", 'switch'],
        ['drizzle eq', "const a = eq(recipes.visibility, 'public');", 'drizzle eq'],
        ['drizzle ne', "const a = ne(recipes.visibility, 'public');", 'drizzle ne'],
        ['drizzle inArray', "const a = inArray(recipes.visibility, ['public']);", 'drizzle inArray'],
        ['drizzle notInArray', "const a = notInArray(recipes.visibility, ['public']);", 'drizzle notInArray'],
        ['sql =', "const q = sql`SELECT id FROM recipes WHERE visibility = 'public'`;", 'sql text'],
        ['sql <>', "const q = sql`WHERE visibility <> 'public'`;", 'sql text'],
        ['sql !=', "const q = sql`WHERE visibility != 'public'`;", 'sql text'],
        ['sql IN', "const q = sql`WHERE visibility IN ('public')`;", 'sql text'],
        ['sql NOT IN', "const q = sql`WHERE visibility NOT IN ('private')`;", 'sql text'],
        ['sql = ANY', 'const q = sql`WHERE visibility = ANY($1)`;', 'sql text'],
        ['sql IS DISTINCT FROM', "const q = sql`WHERE visibility IS DISTINCT FROM 'private'`;", 'sql text'],
        ['sql IS NOT DISTINCT FROM', "const q = sql`WHERE visibility IS NOT DISTINCT FROM 'private'`;", 'sql text'],
        ['sql NOT (visibility = ...)', "const q = sql`WHERE NOT (visibility = 'public')`;", 'sql text'],
        ['an interpolated column', 'const q = sql`WHERE ${recipes.visibility} = ${v}`;', 'sql interpolation'],
        ['a plain SQL string', 'const q = "SELECT id FROM recipes WHERE visibility = \'public\'";', 'sql text'],
        [
            'raw SQL in a worker that never imports recipes',
            "pool.query(`DELETE FROM recipes WHERE visibility <> 'private'`);",
            'sql text',
        ],
        ['a literal hold', 'const row = { id, heldFromReaders: false };', 'heldFromReaders literal'],
        ['a literal true hold', 'const row = { id, heldFromReaders: true };', 'heldFromReaders literal'],
    ] as const)('%s', (_name, source, form) => {
        expect(formsOf('x.ts', source)).toContain(form);
    });

    it.each([
        ['a comment', "// row.visibility === 'public'\nconst a = 1;"],
        ['a string that is not SQL', "const a = 'visibility = public is a phrase';"],
        ['a column in a select list', 'const q = sql`SELECT recipes.visibility, recipes.status FROM recipes`;'],
        ['a hold taken from a selected column', 'const row = { id, heldFromReaders: heldFromReadersSql() };'],
        ['a hold taken from a variable', 'const row = { id, heldFromReaders: held };'],
        ['another property compared with public', "const a = row.kind === 'public';"],
    ] as const)('stays green on %s', (_name, source) => {
        expect(formsOf('x.ts', source)).toEqual([]);
    });

    it('keys a site by its enclosing function', () => {
        const sites = visibilitySitesOf(
            'f.ts',
            "class A { read(r) { return r.visibility === 'public'; } write(r) { return r.visibility === 'public'; } }\nconst top = r.visibility === 'public';",
        );

        expect(sites.map((site) => site.site)).toEqual(['f.ts#A.read', 'f.ts#A.write', 'f.ts#<top>']);
    });

    it('finds a fixture import', () => {
        expect(fixtureImportsOf('x.ts', "import { makeRecipeRow } from '../__fixtures__/index.js';")).toEqual([
            '../__fixtures__/index.js',
        ]);
        expect(fixtureImportsOf('x.ts', "import { a } from './recipePredicates.js';")).toEqual([]);
    });
});

describe('the baseline comparison', () => {
    it('is silent on equality', () => {
        expect(baselineDifferences({ 'f#a': 2 }, { 'f#a': 2 })).toEqual([]);
    });

    it('fails a new site, a higher count, a lower count and a stale entry', () => {
        expect(baselineDifferences({ 'f#a': 1, 'f#b': 1 }, { 'f#a': 1 })).toEqual(['f#b: found 1, recorded 0']);
        expect(baselineDifferences({ 'f#a': 2 }, { 'f#a': 1 })).toEqual(['f#a: found 2, recorded 1']);
        expect(baselineDifferences({ 'f#a': 1 }, { 'f#a': 2 })).toEqual(['f#a: found 1, recorded 2']);
        expect(baselineDifferences({}, { 'f#a': 1 })).toEqual(['f#a: found 0, recorded 1']);
    });

    it('swap: a write check removed from one method and a read added to another in the SAME file fails at the same file total', () => {
        const before = countsOf(
            visibilitySitesOf(
                'recipes.service.ts',
                "class S { setVisibility(r) { return r.visibility === 'public'; } getById(r) { return r.id; } }",
            ),
        );
        const after = countsOf(
            visibilitySitesOf(
                'recipes.service.ts',
                "class S { setVisibility(r) { return r.id; } getById(r) { return r.visibility === 'public'; } }",
            ),
        );

        expect(Object.values(after).reduce((a, b) => a + b, 0)).toBe(Object.values(before).reduce((a, b) => a + b, 0));
        expect(baselineDifferences(after, before)).toHaveLength(2);
    });
});

describe('the tree', () => {
    const files = presentFiles([...SCOPES]).filter((file) => file.endsWith('.ts') && !isTestFile(file));
    const sources = new Map(files.map((file) => [file, readFileSync(path.join(repoRoot, file), 'utf8')] as const));
    const found = files.flatMap((file) => visibilitySitesOf(file, sources.get(file) ?? ''));
    const baseline = (JSON.parse(readFileSync(path.join(repoRoot, BASELINE_PATH), 'utf8')) as { sites: SiteCounts })
        .sites;

    it('scans the services it names', () => {
        expect(files.some((file) => file.startsWith(SCOPES[0]))).toBe(true);
        expect(files.some((file) => file.startsWith(SCOPES[1]))).toBe(true);
    });

    it('compares a recipe visibility only in an allowlisted file', () => {
        const outside = found
            .filter((site) => site.form !== 'heldFromReaders literal')
            .filter((site) => ALLOWLIST[site.site.split('#')[0] ?? ''] === undefined)
            .map((site) => `${site.site} (${site.form})`);

        expect(outside).toEqual([]);
    });

    it('holds the count of every allowlisted site exactly', () => {
        const allowed = countsOf(found.filter((site) => ALLOWLIST[site.site.split('#')[0] ?? ''] !== undefined));

        expect(baselineDifferences(allowed, baseline)).toEqual([]);
    });

    it('gives every allowlist entry a reason and a file that exists', () => {
        for (const [file, reason] of Object.entries(ALLOWLIST)) {
            expect(reason.trim().length, file).toBeGreaterThan(10);
            expect(sources.has(file), `${file} is not a scanned file`).toBe(true);
        }
    });

    it('never fills heldFromReaders with a literal in non-test code', () => {
        expect(found.filter((site) => site.form === 'heldFromReaders literal').map((site) => site.site)).toEqual([]);
    });

    it('imports nothing from a __fixtures__ path in non-test code', () => {
        const importers = files.filter(
            (file) =>
                (sources.get(file) ?? '').includes('__fixtures__') &&
                fixtureImportsOf(file, sources.get(file) ?? '').length > 0,
        );

        expect(importers).toEqual([]);
    });

    it('has the erasure worker call recipe_held_from_readers', () => {
        expect(sources.get(ERASURE)).toContain('recipe_held_from_readers');
    });

    it('has the predicates call recipe_held_from_readers', () => {
        expect(sources.get(PREDICATES)).toContain('recipe_held_from_readers');
    });
});
