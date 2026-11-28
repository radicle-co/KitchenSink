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
 *   `recipeReadRuleBaseline.json`, the ONE registry: every SITE (`file#function`) it records carries its count and its reason,
 *   and the allowlist of files is the set of files those keys name. The counts are held EXACTLY, so a write check removed in
 *   one method and a read added in another fails even when the file total is equal. This is an approval baseline, not a
 *   ratchet: a count may rise, with its reason written in the same PR, where a reviewer sees it.
 * - In non-test code a `heldFromReaders` property, shorthand or not, fails unless its value is a `heldFromReadersSql()` call
 *   (today exactly one site, `readableRecipeColumns`), so no TypeScript twin of the rule can be written. `__fixtures__`,
 *   `__tests__` and `tests` are test code, and no non-test file may import from a `__fixtures__` path.
 * - The erasure worker and the shared predicates must contain `recipe_held_from_readers` in CODE (comments stripped), because
 *   the worker's kept set is a raw SQL statement this scan cannot follow into the database.
 *
 * ✅ THE FIX FOR A FAILURE: read through `readableBy`, `viewableBy`, `communityOf` or `isRecipeViewableBy`. A genuine WRITE
 * check or another entity's visibility is recorded in the baseline with its reason.
 *
 * Limit, stated: the guard fails a comparison it can see. A read with no visibility predicate at all is caught only by the
 * per-path truth-table e2e (`heldFromReaders.e2e.test.ts`).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { over, stale, type FileCounts } from './ratchetBaseline.js';
import { fixtureImportsOf, HELD_FORM, visibilitySitesOf, type VisibilitySite } from './recipeVisibilityReads.js';
import { isTestFile, presentFiles, repoRoot } from './serviceSources.js';
import { withoutTsComments } from './sourceComments.js';

const SCOPES = ['packages/services/recipe-service/src', 'packages/services/recipe-workers/src'] as const;
const BASELINE_PATH = 'packages/tools/repoGuards/__tests__/recipeReadRuleBaseline.json';
const PREDICATES = 'packages/services/recipe-service/src/recipes/dal/recipePredicates.ts';
const ERASURE = 'packages/services/recipe-workers/src/handlers/accountErasureWorker.ts';

/** One recorded site: how many comparisons it holds, and why each is not a recipe read. */
interface RecordedSite {
    readonly count: number;
    readonly reason: string;
}

function countsOf(sites: readonly VisibilitySite[]): FileCounts {
    const counts: Record<string, number> = {};

    for (const { site } of sites) {
        counts[site] = (counts[site] ?? 0) + 1;
    }

    return counts;
}

/**
 * Every difference between the sites found and the sites recorded, through the house helpers: a site above its count (or new)
 * is `over`, and a recorded site below its count is `stale`. Equality is the rule, so a change in either direction updates the
 * approval baseline. Pure.
 */
function baselineDifferences(actual: FileCounts, recorded: FileCounts): string[] {
    return [...over(actual, recorded), ...stale(actual, recorded)].sort();
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
        ['a quoted column', 'const q = sql`WHERE "visibility" = \'public\'`;', 'sql text'],
        ['a qualified quoted column', 'const q = sql`WHERE r."visibility" = \'public\'`;', 'sql text'],
        ['a cast column', "const q = sql`WHERE visibility::text = 'public'`;", 'sql text'],
        ['a quoted cast column', 'const q = sql`WHERE r."visibility"::text <> \'private\'`;', 'sql text'],
        ['an interpolated column', 'const q = sql`WHERE ${recipes.visibility} = ${v}`;', 'sql interpolation'],
        ['a plain SQL string', 'const q = "SELECT id FROM recipes WHERE visibility = \'public\'";', 'sql text'],
        [
            'raw SQL in a worker that never imports recipes',
            "pool.query(`DELETE FROM recipes WHERE visibility <> 'private'`);",
            'sql text',
        ],
        ['a literal hold', 'const row = { id, heldFromReaders: false };', HELD_FORM],
        ['a literal true hold', 'const row = { id, heldFromReaders: true };', HELD_FORM],
        ['a hold copied from a column', 'const row = { id, heldFromReaders: r.sourceCorrectionHold };', HELD_FORM],
        ['a hold from a ternary', "const row = { id, heldFromReaders: r.kind === 'x' ? true : false };", HELD_FORM],
        ['a shorthand hold', 'const heldFromReaders = f(r); const row = { id, heldFromReaders };', HELD_FORM],
        ['a hold from a variable', 'const row = { id, heldFromReaders: held };', HELD_FORM],
        ['a hold from another function', 'const row = { id, heldFromReaders: heldOf(r) };', HELD_FORM],
    ] as const)('%s', (_name, source, form) => {
        expect(formsOf('x.ts', source)).toContain(form);
    });

    it.each([
        ['a comment', "// row.visibility === 'public'\nconst a = 1;"],
        ['a string that is not SQL', "const a = 'visibility = public is a phrase';"],
        ['a column in a select list', 'const q = sql`SELECT recipes.visibility, recipes.status FROM recipes`;'],
        ['a hold taken from a selected column', 'const row = { id, heldFromReaders: heldFromReadersSql() };'],
        ['a type member named for the field', 'interface R { readonly heldFromReaders: boolean }'],
        ['a quoted column in a select list', 'const q = sql`SELECT r."visibility" FROM recipes r`;'],
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
        expect(baselineDifferences({ 'f#a': 1, 'f#b': 1 }, { 'f#a': 1 })).toEqual(['f#b: 1 > 0']);
        expect(baselineDifferences({ 'f#a': 2 }, { 'f#a': 1 })).toEqual(['f#a: 2 > 1']);
        expect(baselineDifferences({ 'f#a': 1 }, { 'f#a': 2 })).toEqual(['f#a: recorded 2, now 1']);
        expect(baselineDifferences({}, { 'f#a': 1 })).toEqual(['f#a: recorded 1, now 0']);
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

describe('a name that only a comment mentions', () => {
    it('does not satisfy the code check: comments are stripped first', () => {
        const source = '/** recipe_held_from_readers is called here */\n// recipe_held_from_readers\nconst a = 1;';

        expect(source).toContain('recipe_held_from_readers');
        expect(withoutTsComments(source)).not.toContain('recipe_held_from_readers');
    });

    it('is satisfied by the name in code', () => {
        expect(withoutTsComments('const q = sql`recipe_held_from_readers(r, $1)`;')).toContain(
            'recipe_held_from_readers',
        );
    });
});

describe('the tree', () => {
    const files = presentFiles([...SCOPES]).filter((file) => file.endsWith('.ts') && !isTestFile(file));
    const sources = new Map(files.map((file) => [file, readFileSync(path.join(repoRoot, file), 'utf8')] as const));
    const found = files.flatMap((file) => visibilitySitesOf(file, sources.get(file) ?? ''));
    const registry = (
        JSON.parse(readFileSync(path.join(repoRoot, BASELINE_PATH), 'utf8')) as {
            sites: Record<string, RecordedSite>;
        }
    ).sites;
    const recorded: FileCounts = Object.fromEntries(Object.entries(registry).map(([site, { count }]) => [site, count]));
    const allowlisted = new Set(Object.keys(registry).map((site) => site.split('#')[0] ?? ''));
    const comparisons = found.filter((site) => site.form !== HELD_FORM);
    const code = (file: string): string => withoutTsComments(sources.get(file) ?? '', file);

    it('scans the services it names', () => {
        expect(files.some((file) => file.startsWith(SCOPES[0]))).toBe(true);
        expect(files.some((file) => file.startsWith(SCOPES[1]))).toBe(true);
    });

    it('compares a recipe visibility only in a file the registry names', () => {
        const outside = comparisons
            .filter((site) => !allowlisted.has(site.site.split('#')[0] ?? ''))
            .map((site) => `${site.site} (${site.form})`);

        expect(outside).toEqual([]);
    });

    it('holds the count of every recorded site exactly', () => {
        expect(baselineDifferences(countsOf(comparisons), recorded)).toEqual([]);
    });

    it('gives every recorded site a reason, a count of at least one and a scanned file with a site', () => {
        const filesWithSites = new Set(comparisons.map((site) => site.site.split('#')[0]));

        for (const [site, { count, reason }] of Object.entries(registry)) {
            const file = site.split('#')[0] ?? '';

            expect(reason.trim().length, site).toBeGreaterThan(10);
            expect(count, site).toBeGreaterThanOrEqual(1);
            expect(sources.has(file), `${file} is not a scanned file`).toBe(true);
            expect(filesWithSites.has(file), `${file} has no site left: a dead entry`).toBe(true);
        }
    });

    it('fills heldFromReaders only from heldFromReadersSql() in non-test code', () => {
        expect(found.filter((site) => site.form === HELD_FORM).map((site) => site.site)).toEqual([]);
    });

    it('imports nothing from a __fixtures__ path in non-test code', () => {
        const importers = files.filter(
            (file) =>
                (sources.get(file) ?? '').includes('__fixtures__') &&
                fixtureImportsOf(file, sources.get(file) ?? '').length > 0,
        );

        expect(importers).toEqual([]);
    });

    it('has the erasure worker call recipe_held_from_readers in code', () => {
        expect(code(ERASURE)).toContain('recipe_held_from_readers');
    });

    it('has the predicates call recipe_held_from_readers in code', () => {
        expect(code(PREDICATES)).toContain('recipe_held_from_readers');
    });
});
