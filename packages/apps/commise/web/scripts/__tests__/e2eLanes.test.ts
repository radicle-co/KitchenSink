// @vitest-environment node
/**
 * The pure setup of the parallel Playwright lanes (`scripts/e2eLanes.ts`): what each lane is given, which ports they
 * get, how a Playwright JSON report is read, and the verdict over all lanes.
 *
 * The verdict is the part that must be able to fail. A lane that crashed before it listed its tests, or a shard that
 * quietly lost a file, leaves the other lanes green; only the comparison of the merged count with the count listed
 * BEFORE the run notices. Each test below is one way that comparison could be
 * dropped, and it fails if it is.
 */
import { describe, expect, it } from 'vitest';

import {
    DEAD_ORIGIN,
    buildEnv,
    countTests,
    decideSpecs,
    distinctPorts,
    flattenReport,
    laneArgs,
    laneEnv,
    parseReport,
    specFilters,
    testListText,
    verdict,
    wantsSelection,
    type PlaywrightReport,
} from '../e2eLanes';

const report = (tests: readonly { project: string; title: string; status: string }[]): PlaywrightReport => ({
    suites: [
        {
            title: 'a.spec.ts',
            file: 'a.spec.ts',
            specs: [],
            suites: [
                {
                    title: 'group',
                    specs: tests.map((test) => ({
                        title: test.title,
                        file: 'a.spec.ts',
                        tests: [{ projectName: test.project, status: test.status }],
                    })),
                },
            ],
        },
    ],
});

describe('buildEnv', () => {
    it('builds once, stops after the build, and pins every API origin to a dead address', () => {
        const env = buildEnv({ PATH: '/bin' });

        expect(env['E2E_BUILD_ONLY']).toBe('1');
        expect(env['NEXT_PUBLIC_RECIPE_API_URL']).toBe(DEAD_ORIGIN);
        expect(env['NEXT_PUBLIC_IDENTITY_API_URL']).toBe(DEAD_ORIGIN);
        expect(env['NEXT_PUBLIC_FOOD_API_URL']).toBe(DEAD_ORIGIN);
        expect(env['PATH']).toBe('/bin');
    });
});

describe('laneEnv', () => {
    const env = laneEnv({ PATH: '/bin' }, { index: 3, count: 4, port: 3033 });

    it('serves a finished build on its own port, as its own shard', () => {
        expect(env['E2E_SKIP_BUILD']).toBe('1');
        expect(env['E2E_PORT']).toBe('3033');
        expect(env['COMMISE_E2E_SHARD']).toBe('3');
    });

    it('writes a blob report as well as a list, so the lanes can be merged', () => {
        expect(env['E2E_REPORTER']).toBe('list,blob');
        expect(env['PLAYWRIGHT_BLOB_OUTPUT_DIR']).toBe('blob-report/lane-3');
    });

    it('gives every lane its own blob folder, because a blob reporter deletes its folder when it ends', () => {
        const other = laneEnv({}, { index: 1, count: 4, port: 3010 });

        expect(other['PLAYWRIGHT_BLOB_OUTPUT_DIR']).not.toBe(env['PLAYWRIGHT_BLOB_OUTPUT_DIR']);
    });

    it('bakes the same dead origins the build was made with, so a lane never disagrees with its artifact', () => {
        expect(env['NEXT_PUBLIC_RECIPE_API_URL']).toBe(DEAD_ORIGIN);
    });

    it('does not mutate the environment it was given', () => {
        const base = { PATH: '/bin' };
        laneEnv(base, { index: 1, count: 2, port: 3010 });

        expect(base).toEqual({ PATH: '/bin' });
    });
});

describe('laneArgs', () => {
    it('shards over whatever it was asked to run, with its own output folder', () => {
        expect(laneArgs({ index: 2, count: 4 }, ['tests/e2e/a.spec.ts'])).toEqual([
            'tests/e2e/a.spec.ts',
            '--shard=2/4',
            '--output=test-results/lane-2',
        ]);
    });

    it('passes a test list through when one was given', () => {
        expect(laneArgs({ index: 1, count: 2 }, [], '/tmp/list.txt')).toEqual([
            '--test-list',
            '/tmp/list.txt',
            '--shard=1/2',
            '--output=test-results/lane-1',
        ]);
    });
});

describe('distinctPorts', () => {
    it('gives every lane a different port, skipping the taken ones', () => {
        const taken = new Set([3011]);
        const ports = distinctPorts(3, (port) => taken.has(port));

        expect(ports).toEqual([3010, 3012, 3013]);
    });

    it('fails loudly when the range has too few free ports', () => {
        expect(() => distinctPorts(2, () => true)).toThrow(/free port/u);
    });
});

describe('flattenReport and countTests', () => {
    const tests = [
        { project: 'setup', title: 'sign in', status: 'expected' },
        { project: 'chromium', title: 'one', status: 'expected' },
        { project: 'chromium', title: 'two', status: 'unexpected' },
        { project: 'own-session', title: 'three', status: 'flaky' },
        { project: 'chromium', title: 'four', status: 'skipped' },
    ];

    it('reads every test with its project and status', () => {
        expect(flattenReport(report(tests))).toHaveLength(5);
        expect(flattenReport(report(tests))[2]).toMatchObject({ project: 'chromium', status: 'unexpected' });
    });

    it('counts the tests that are not setup, because every lane that needs the session runs setup again', () => {
        expect(countTests(report(tests))).toBe(4);
    });
});

describe('verdict', () => {
    it('passes only when every lane passed and the merged count equals the listed count', () => {
        expect(verdict({ listed: 10, merged: 10, laneCodes: [0, 0, 0] })).toEqual({ exitCode: 0, problems: [] });
    });

    it('fails on a count mismatch even when every lane exited 0', () => {
        const result = verdict({ listed: 10, merged: 9, laneCodes: [0, 0] });

        expect(result.exitCode).not.toBe(0);
        expect(result.problems.join(' ')).toMatch(/10.*9|9.*10/u);
    });

    it('fails on a merged count that is larger, too (a test that ran twice proves nothing about the other)', () => {
        expect(verdict({ listed: 10, merged: 11, laneCodes: [0] }).exitCode).not.toBe(0);
    });

    it('exits with the worst lane code', () => {
        expect(verdict({ listed: 4, merged: 4, laneCodes: [0, 1, 2] }).exitCode).toBe(2);
    });

    it('treats a lane that was killed (null code) as a failure', () => {
        expect(verdict({ listed: 4, merged: 4, laneCodes: [0, null] }).exitCode).not.toBe(0);
    });
});

describe('parseReport', () => {
    it('reads a report and keeps the fields the counts need', () => {
        const parsed = parseReport(JSON.stringify(report([{ project: 'chromium', title: 'one', status: 'expected' }])));

        expect(countTests(parsed)).toBe(1);
    });

    it('refuses output that is not a Playwright report, rather than counting zero tests', () => {
        expect(() => parseReport('Loaded env from .env.local')).toThrow();
        expect(() => parseReport('{"errors": []}')).toThrow();
    });
});

describe('wantsSelection', () => {
    it('selects by default: a bare local run asks the impacted-test selector', () => {
        expect(wantsSelection([], {})).toBe(true);
    });

    it.each([
        ['FULL_SUITE=1, which forces the whole suite', [], { FULL_SUITE: '1' }],
        ['an explicit test list', [], { E2E_TEST_LIST: '/tmp/list.txt' }],
        ['a spec named on the command line', ['tests/e2e/home.spec.ts'], {}],
        ['an option on the command line', ['--grep', 'sign in'], {}],
    ])('does not select when the caller already chose: %s', (_name, passthrough, env) => {
        expect(wantsSelection(passthrough, env)).toBe(false);
    });

    it('does not mistake FULL_SUITE=0 or an empty value for the switch', () => {
        expect(wantsSelection([], { FULL_SUITE: '0' })).toBe(true);
        expect(wantsSelection([], { FULL_SUITE: '' })).toBe(true);
    });
});

describe('specFilters', () => {
    it('names each spec by its exact path under tests/e2e, ending at the file name', () => {
        expect(specFilters(['home.spec.ts', 'nested/a.spec.ts'])).toEqual([
            'tests/e2e/home\\.spec\\.ts$',
            'tests/e2e/nested/a\\.spec\\.ts$',
        ]);
    });

    it('escapes every character a regular expression would read', () => {
        const [filter] = specFilters(['a+b(1).spec.ts']);

        expect(new RegExp(filter ?? '', 'u').test('tests/e2e/a+b(1).spec.ts')).toBe(true);
        expect(new RegExp(filter ?? '', 'u').test('tests/e2e/aab1.spec.ts')).toBe(false);
    });
});

describe('testListText', () => {
    const tests = [
        { project: 'setup', title: 'sign in', status: 'x' },
        { project: 'chromium', title: 'one', status: 'x' },
        { project: 'reflow320', title: 'one', status: 'x' },
    ];

    it('writes one --test-list line per test, project in brackets, and leaves setup to the dependency', () => {
        expect(testListText(flattenReport(report(tests)))).toBe(
            ['[chromium] › a.spec.ts › group › one', '[reflow320] › a.spec.ts › group › one', ''].join('\n'),
        );
    });
});

describe('decideSpecs', () => {
    const test = (project: string, file: string, title = 't') => ({
        project,
        id: `${project} › ${file} › ${title}`,
        status: 'x',
    });
    const lister = (tests: ReturnType<typeof test>[]) => () => tests;

    it('runs everything when the selector says every spec', () => {
        expect(decideSpecs({ kind: 'all', reasons: ['x'] }, lister([]))).toEqual({ kind: 'unselected' });
    });

    it('runs nothing, and says why, when the selector found no spec to run', () => {
        expect(decideSpecs({ kind: 'some', ids: [] }, lister([]))).toMatchObject({ kind: 'none' });
    });

    it('lists exactly the tests of the selected specs when each contributes one', () => {
        const tests = [test('chromium', 'a.spec.ts'), test('reflow320', 'a.spec.ts'), test('chromium', 'b.spec.ts')];

        expect(decideSpecs({ kind: 'some', ids: ['a.spec.ts', 'b.spec.ts'] }, lister(tests))).toEqual({
            kind: 'list',
            specs: 2,
            tests,
        });
    });

    it('leaves setup out of the list and the count', () => {
        const tests = [test('setup', 'auth.setup.ts'), test('chromium', 'a.spec.ts')];
        const choice = decideSpecs({ kind: 'some', ids: ['a.spec.ts'] }, lister(tests));

        expect(choice).toEqual({ kind: 'list', specs: 1, tests: [tests[1]] });
    });

    it('runs every spec, naming the one, when a selected spec lists no test: its tests may be gone from this configuration', () => {
        const choice = decideSpecs(
            { kind: 'some', ids: ['a.spec.ts', 'ghost.spec.ts'] },
            lister([test('chromium', 'a.spec.ts')]),
        );

        expect(choice).toMatchObject({ kind: 'unselected' });
        expect(JSON.stringify(choice)).toContain('ghost.spec.ts');
    });

    it('runs every spec, never none, when the selected specs list no test at all', () => {
        expect(decideSpecs({ kind: 'some', ids: ['a.spec.ts'] }, lister([]))).toMatchObject({ kind: 'unselected' });
    });

    it('runs every spec, saying why, when listing throws', () => {
        const choice = decideSpecs({ kind: 'some', ids: ['a.spec.ts'] }, () => {
            throw new Error('config broke');
        });

        expect(choice).toMatchObject({ kind: 'unselected' });
        expect(JSON.stringify(choice)).toContain('config broke');
    });
});
