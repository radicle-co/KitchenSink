import { describe, expect, it } from 'vitest';

import { checkCoverage, parseCoverage, uncoveredRoutes } from '../src/coverageTable.js';

describe('parseCoverage', () => {
    it('reads one row per line: the test, a tab, comma-separated screens', () => {
        const table = parseCoverage('a.spec.ts\t/, /recipes\nb.spec.ts\t/discover\n', 'web.tsv');

        expect([...(table.get('a.spec.ts') ?? [])]).toEqual(['/', '/recipes']);
        expect([...(table.get('b.spec.ts') ?? [])]).toEqual(['/discover']);
    });

    it('ignores blank lines and # comments', () => {
        expect(parseCoverage('# why\n\na.spec.ts\t/\n', 'x').size).toBe(1);
    });

    it.each([
        ['a row with no tab', 'a.spec.ts /\n', /line 1/u],
        ['a duplicate test', 'a.spec.ts\t/\na.spec.ts\t/b\n', /line 2.*twice/u],
    ])('rejects %s', (_name, text, message) => {
        expect(() => parseCoverage(text, 'x.tsv')).toThrow(message);
    });
});

const table = new Map<string, ReadonlySet<string>>([
    ['a.spec.ts', new Set(['/', '/recipes'])],
    ['b.spec.ts', new Set(['*'])],
]);

describe('parseCoverage: an empty row', () => {
    it('reads a row with nothing after the tab as a row with no screens', () => {
        const table = parseCoverage('# c\nrecipes/common/scroll\t\nrecipes/a\tHomeScreen\n', 'x.tsv');

        expect(table.get('recipes/common/scroll')).toEqual(new Set());
        expect(table.get('recipes/a')).toEqual(new Set(['HomeScreen']));
    });

    it('still refuses a row with no tab at all, which is a test id and nothing', () => {
        expect(() => parseCoverage('recipes/common/scroll\n', 'x.tsv')).toThrow(/row is a test id/u);
    });
});

describe('checkCoverage: an empty row', () => {
    const table = new Map([
        ['top', new Set<string>()],
        ['helper', new Set<string>()],
    ]);

    it('is a problem for a top-level test, which always shows some screen', () => {
        const problems = checkCoverage({ tests: ['top'], optional: ['helper'], screens: ['a'], table });

        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/top.*no screens/u);
    });

    it('is allowed for a sub-flow, which may act on its caller’s screen', () => {
        expect(
            checkCoverage({
                tests: [],
                optional: ['helper', 'top'],
                screens: ['a'],
                table: new Map([['helper', new Set<string>()]]),
            }),
        ).toEqual([]);
    });
});

describe('checkCoverage', () => {
    it('passes when every test has a row and every row names real screens', () => {
        expect(checkCoverage({ tests: ['a.spec.ts', 'b.spec.ts'], screens: ['/', '/recipes'], table })).toEqual([]);
    });

    it('lets a sub-flow have a row without requiring one, since only top-level flows are run', () => {
        const withSub = new Map([...table, ['auth/signin', new Set(['login'])]]);

        expect(
            checkCoverage({
                tests: ['a.spec.ts', 'b.spec.ts'],
                optional: ['auth/signin'],
                screens: ['/', '/recipes', 'login'],
                table: withSub,
            }),
        ).toEqual([]);
        expect(
            checkCoverage({ tests: ['a.spec.ts', 'b.spec.ts'], screens: ['/', '/recipes', 'login'], table: withSub }),
        ).toEqual([expect.stringContaining('auth/signin has a row but no such test exists')]);
    });

    it('fails a test with no row', () => {
        const problems = checkCoverage({
            tests: ['a.spec.ts', 'b.spec.ts', 'c.spec.ts'],
            screens: ['/', '/recipes'],
            table,
        });

        expect(problems).toEqual([expect.stringContaining('c.spec.ts has no row')]);
    });

    it('fails a row for a test that does not exist', () => {
        const problems = checkCoverage({ tests: ['a.spec.ts'], screens: ['/', '/recipes'], table });

        expect(problems).toEqual([expect.stringContaining('b.spec.ts')]);
    });

    it('fails a row that names a screen that does not exist', () => {
        const problems = checkCoverage({ tests: ['a.spec.ts', 'b.spec.ts'], screens: ['/'], table });

        expect(problems).toEqual([expect.stringContaining('/recipes')]);
    });
});

describe('uncoveredRoutes', () => {
    const screens = ['/', '/recipes', '/recipes/[id]', '/recipes/new'];

    it('passes when the row names the screen of every path the test visits', () => {
        const row = new Set(['/', '/recipes/[id]']);

        expect(
            uncoveredRoutes({ row, screens, visited: { paths: ['/recipes/__dynamic__', '/'], dynamic: false } }),
        ).toEqual([]);
    });

    it('names a visited screen the row leaves out', () => {
        const row = new Set(['/']);
        const problems = uncoveredRoutes({ row, screens, visited: { paths: ['/recipes/new'], dynamic: false } });

        expect(problems).toEqual([expect.stringContaining('/recipes/new')]);
    });

    it('accepts a path no screen serves, which can only reach the not-found root', () => {
        expect(
            uncoveredRoutes({ row: new Set(['/']), screens, visited: { paths: ['/nope'], dynamic: false } }),
        ).toEqual([]);
    });

    it('demands an all-screens row from a test whose path cannot be read', () => {
        const visited = { paths: [], dynamic: true };

        expect(uncoveredRoutes({ row: new Set(['/']), screens, visited })).toEqual([expect.stringContaining('*')]);
        expect(uncoveredRoutes({ row: new Set(['*']), screens, visited })).toEqual([]);
    });

    it('accepts any visit from a test whose row is *', () => {
        const visited = { paths: ['/recipes/new'], dynamic: false };

        expect(uncoveredRoutes({ row: new Set(['*']), screens, visited })).toEqual([]);
    });
});
