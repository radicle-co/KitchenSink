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
    LANE_COST,
    SERVER_COST,
    buildEnv,
    countTests,
    decideSpecs,
    distinctPorts,
    flattenReport,
    durationTable,
    laneArgs,
    laneEnv,
    laneLists,
    medianMs,
    outcomesOf,
    selectorChose,
    serverEnv,
    wantsSharedServer,
    parseReport,
    specFilters,
    testListText,
    verdict,
    wantsSelection,
    type PlaywrightReport,
} from '../e2eLanes';

const report = (
    tests: readonly { project: string; title: string; status: string; ms?: number }[],
): PlaywrightReport => ({
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
                        tests: [
                            {
                                projectName: test.project,
                                status: test.status,
                                ...(test.ms === undefined ? {} : { results: [{ duration: test.ms }] }),
                            },
                        ],
                    })),
                },
            ],
        },
    ],
});

/**
 * Measured 2026-11-08, full suite, 8 lanes on one shared `next start`, 20 CPUs, sampled every 2 s over the process
 * trees (a lane is its Playwright process and its browsers). Per lane: CPU mean 0.34 cores (p95 0.67, p99 0.87), RSS
 * mean 1.17 GiB (p95 1.30 GiB, peak 1.88 GiB; summed RSS counts shared pages twice, so it overstates). Shared server:
 * CPU mean 0.54 (peak 0.90), RSS mean 0.57 GiB (peak 0.62 GiB). A cost below its measured p95 would let the planner
 * oversubscribe the machine.
 */
describe('the measured cost of a lane and of the shared server', () => {
    const GIB = 1024 ** 3;

    it('covers a lane’s p95 CPU and memory', () => {
        expect(LANE_COST.cpus).toBeGreaterThanOrEqual(0.67);
        expect(LANE_COST.memBytes).toBeGreaterThanOrEqual(1.3 * GIB);
    });

    it('covers the shared server’s peak CPU and memory', () => {
        expect(SERVER_COST.cpus).toBeGreaterThanOrEqual(0.9);
        expect(SERVER_COST.memBytes).toBeGreaterThanOrEqual(0.62 * GIB);
    });

    it('is not padded back to the old per-lane figure, which paid for a server each', () => {
        expect(LANE_COST.cpus).toBeLessThan(1.5);
        expect(LANE_COST.memBytes).toBeLessThan(2 * GIB);
    });
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

    it('names each lane’s blob after the lane, so merged blobs never overwrite one another', () => {
        expect(env['PLAYWRIGHT_BLOB_OUTPUT_NAME']).toBe('report-3.zip');
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

describe('laneEnv with one shared server', () => {
    const shared = laneEnv({ PATH: '/bin' }, { index: 2, count: 4, port: 3040, sharedServer: true });

    it('points the lane at the shared port and says the server is not its own', () => {
        expect(shared['E2E_PORT']).toBe('3040');
        expect(shared['E2E_SHARED_SERVER']).toBe('1');
    });

    it('keeps the lane’s own pool slot, so two lanes on one server are still two users', () => {
        const other = laneEnv({}, { index: 3, count: 4, port: 3040, sharedServer: true });

        expect(shared['COMMISE_E2E_SHARD']).toBe('2');
        expect(other['COMMISE_E2E_SHARD']).toBe('3');
    });

    it('leaves the flag out when each lane has its own server', () => {
        expect(laneEnv({}, { index: 1, count: 2, port: 3010 })['E2E_SHARED_SERVER']).toBeUndefined();
    });
});

describe('serverEnv', () => {
    const env = serverEnv({ PATH: '/bin', E2E_BUILD_ONLY: '1' }, 3040);

    it('serves the finished build on the given port', () => {
        expect(env['PORT']).toBe('3040');
        expect(env['PATH']).toBe('/bin');
    });

    it('pins every API origin to the dead address the build was made with', () => {
        expect(env['NEXT_PUBLIC_RECIPE_API_URL']).toBe(DEAD_ORIGIN);
        expect(env['NEXT_PUBLIC_IDENTITY_API_URL']).toBe(DEAD_ORIGIN);
        expect(env['NEXT_PUBLIC_FOOD_API_URL']).toBe(DEAD_ORIGIN);
    });

    it('routes the pseudo-locale, as the server the config would have started does', () => {
        expect(env['COMMISE_PSEUDO_LOCALE']).toBe('1');
    });

    it('does not carry the build-only switch into a server', () => {
        expect(env['E2E_BUILD_ONLY']).toBeUndefined();
    });
});

describe('wantsSharedServer', () => {
    it('is the default, because the lanes only differ by user and nothing in the server is per user', () => {
        expect(wantsSharedServer({})).toBe(true);
    });

    it('is switched off by E2E_SHARED_SERVER=0, which restores one server per lane', () => {
        expect(wantsSharedServer({ E2E_SHARED_SERVER: '0' })).toBe(false);
    });

    it('is off for the dev server, which compiles routes on demand and is not safe to share', () => {
        expect(wantsSharedServer({ E2E_WEB_SERVER: 'dev' })).toBe(false);
    });
});

describe('laneArgs', () => {
    it('runs exactly the lane’s own list, with its own output folder, and takes no shard', () => {
        const args = laneArgs({ index: 2, count: 4 }, 'test-results/lanes/lane-2.list');

        expect(args).toEqual(['--test-list', 'test-results/lanes/lane-2.list', '--output=test-results/lane-2']);
        expect(args.join(' ')).not.toMatch(/shard/u);
    });
});

describe('laneLists', () => {
    const tests = flattenReport(
        report([
            { project: 'setup', title: 'sign in', status: 'expected' },
            { project: 'chromium', title: 'slow', status: 'expected' },
            { project: 'chromium', title: 'fast one', status: 'expected' },
            { project: 'own-session', title: 'fast two', status: 'expected' },
        ]),
    );
    const durations = Object.fromEntries(tests.map((test, index) => [test.id, [0, 900, 50, 40][index]]));

    it('gives every non-setup test to exactly one lane, as a --test-list line', () => {
        const { texts } = laneLists(tests, durations, 2, 100);
        const lines = texts.flatMap((text) => text.split('\n').filter(Boolean));

        expect(lines.sort()).toEqual(testListText(tests).split('\n').filter(Boolean).sort());
        expect(lines.join('\n')).not.toMatch(/setup/u);
    });

    it('weights by duration: the slow test is alone, the two fast ones share a lane', () => {
        const { texts } = laneLists(tests, durations, 2, 100);

        expect(texts.map((text) => text.split('\n').filter(Boolean).length).sort()).toEqual([1, 2]);
    });

    it('says which tests had no recorded duration', () => {
        expect(laneLists(tests, {}, 2, 100).defaulted).toHaveLength(3);
    });
});

describe('durationTable', () => {
    it('averages a test’s duration across reports, in whole milliseconds, with sorted keys', () => {
        const one = report([
            { project: 'chromium', title: 'b', status: 'expected', ms: 100 },
            { project: 'chromium', title: 'a', status: 'expected', ms: 10 },
        ]);
        const two = report([{ project: 'chromium', title: 'b', status: 'expected', ms: 201 }]);
        const table = durationTable([one, two]);

        expect(Object.keys(table)).toEqual(['chromium › a.spec.ts › group › a', 'chromium › a.spec.ts › group › b']);
        expect(table['chromium › a.spec.ts › group › b']).toBe(151);
    });

    it('sums a retried test’s attempts, because the lane waited for all of them', () => {
        const flaky: PlaywrightReport = {
            suites: [
                {
                    title: 'a.spec.ts',
                    specs: [
                        {
                            title: 't',
                            tests: [
                                {
                                    projectName: 'chromium',
                                    status: 'flaky',
                                    results: [{ duration: 30 }, { duration: 20 }],
                                },
                            ],
                        },
                    ],
                },
            ],
        };

        expect(durationTable([flaky])['chromium › a.spec.ts › t']).toBe(50);
    });

    it('leaves setup out: it is a dependency, never a lane’s own test', () => {
        const table = durationTable([report([{ project: 'setup', title: 's', status: 'expected', ms: 5 }])]);

        expect(table).toEqual({});
    });
});

describe('medianMs', () => {
    it('is the middle duration, and a fixed fallback for an empty table', () => {
        expect(medianMs({ a: 1, b: 100, c: 5 })).toBe(5);
        expect(medianMs({})).toBeGreaterThan(0);
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

describe('outcomesOf', () => {
    const tests = [
        { project: 'setup', title: 'sign in', status: 'unexpected' },
        { project: 'chromium', title: 'one', status: 'expected' },
        { project: 'chromium', title: 'two', status: 'unexpected' },
        { project: 'own-session', title: 'three', status: 'flaky' },
        { project: 'chromium', title: 'four', status: 'skipped' },
    ];

    it('counts a flaky test as a failure: it did not pass on its own, so it cannot move a stamp', () => {
        expect(outcomesOf(flattenReport(report(tests)))).toEqual({ passed: 1, failed: 2, skipped: 1 });
    });

    it('leaves setup out, because a lane runs it as a dependency and it is no selected test', () => {
        expect(outcomesOf(flattenReport(report([tests[0] as (typeof tests)[number]])))).toEqual({
            passed: 0,
            failed: 0,
            skipped: 0,
        });
    });
});

describe('selectorChose', () => {
    it('is true for a bare run and for FULL_SUITE=1, which the selector answers', () => {
        expect(selectorChose([], {})).toBe(true);
        expect(selectorChose([], { FULL_SUITE: '1' })).toBe(true);
    });

    it('is false once a person named a spec, a test list or Playwright arguments', () => {
        expect(selectorChose(['tests/e2e/a.spec.ts'], {})).toBe(false);
        expect(selectorChose([], { E2E_TEST_LIST: 'x.txt' })).toBe(false);
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
        durationMs: 0,
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
