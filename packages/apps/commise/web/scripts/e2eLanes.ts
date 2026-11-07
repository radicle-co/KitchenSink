/**
 * The local Playwright door: runs the suite as N parallel LANES, each a separate Playwright run.
 *
 * ## Why lanes and not workers
 *
 * `playwright.config.ts` keeps `workers: 1` on purpose: one run is ONE Clerk user and ONE Next server, and two
 * workers in it would share both. Two separate RUNS share neither, because each signs in as its own fixed `web` pool
 * slot (`COMMISE_E2E_SHARD`, `tests/e2e/utils/poolSlot.ts`) and serves its own port. So a lane is a run, started with
 * `--shard=k/N` over the same selection.
 *
 * ## The shape of a run
 *
 * 1. Choose the specs: a bare local run asks the impacted-test selector (`@kitchensink/e2e-plan`) which specs the
 *    change affects and runs only those. `FULL_SUITE=1`, an `E2E_TEST_LIST`, or any argument for Playwright skips the
 *    selector. A selector that cannot answer runs everything. Then list the tests (`--list`), so the count to reach is
 *    known BEFORE anything runs.
 * 2. Plan the lane count (`planLanes`): CPU, memory, identities, Clerk's rate limit, the work.
 * 3. Build ONCE (`E2E_BUILD_ONLY`). The three API origins are pinned to {@link DEAD_ORIGIN} for the build AND for
 *    every lane, so the artifact does not depend on which port a lane gets and the turbo cache key is stable.
 * 4. Start the lanes (`E2E_SKIP_BUILD`), staggered, one log each.
 * 5. Merge the blob reports and compare the merged count with the listed count. A lane that died, or a shard that
 *    lost a file, leaves the others green; only that comparison notices.
 *
 * `E2E_LANES=1` or `E2E_WEB_SERVER=dev` gives the single run `e2eLocal.sh` always was.
 *
 * ⚠️ `setup` re-runs in every lane that holds a test needing the shared session (that is correct: each lane signs in
 * as its own slot), so the counts below leave the `setup` project out.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { POOL_ROSTER } from '@kitchensink/e2e-fixtures/testPool';
import { planLanes, type LaneCost } from '@kitchensink/e2e-plan';
import { checkRecordedRoutes } from '@kitchensink/e2e-plan/recordedRoutes';
import { runPlan } from '@kitchensink/e2e-plan/runPlan';
import { z } from 'zod';

/** An address nothing listens on: the discard port. A call to it is REFUSED, as CI's identity and food ports are. */
export const DEAD_ORIGIN = 'http://127.0.0.1:9';

const ORIGIN_VARS = ['NEXT_PUBLIC_RECIPE_API_URL', 'NEXT_PUBLIC_IDENTITY_API_URL', 'NEXT_PUBLIC_FOOD_API_URL'] as const;

const GIB = 1024 ** 3;

/** What one lane costs. PLACEHOLDER until measured. */
export const LANE_COST: LaneCost = { cpus: 2, memBytes: 2 * GIB };

/** The most lanes Clerk's dev instance is allowed to serve at once. PLACEHOLDER until measured. */
export const WEB_LANE_CLERK_CEILING = 8;

const PORT_RANGE = { first: 3010, last: 3060 } as const;
const BLOB_DIR = 'blob-report';
const LANE_LOG_DIR = 'test-results/lanes';

export type Env = Readonly<Record<string, string | undefined>>;

export interface Lane {
    readonly index: number;
    readonly count: number;
}

const deadOrigins = (): Record<string, string> => Object.fromEntries(ORIGIN_VARS.map((name) => [name, DEAD_ORIGIN]));

/**
 * The environment of the one shared build.
 *
 * @param base - The caller's environment.
 * @returns A copy that builds and stops, with every API origin dead.
 */
export function buildEnv(base: Env): Env {
    return { ...base, ...deadOrigins(), E2E_BUILD_ONLY: '1' };
}

/**
 * The environment of one lane.
 *
 * @param base - The caller's environment.
 * @param lane - Which lane, of how many, on which port.
 * @returns A copy that serves the finished build as that lane's pool slot.
 */
export function laneEnv(base: Env, lane: Lane & { readonly port: number }): Env {
    return {
        ...base,
        ...deadOrigins(),
        E2E_SKIP_BUILD: '1',
        E2E_PORT: String(lane.port),
        COMMISE_E2E_SHARD: String(lane.index),
        E2E_REPORTER: 'list,blob',
        PLAYWRIGHT_BLOB_OUTPUT_DIR: `${BLOB_DIR}/lane-${lane.index}`,
    };
}

/** What to run: an optional `--test-list` file, then the caller's own arguments. */
const selection = (passthrough: readonly string[], testList: string | undefined): readonly string[] => [
    ...(testList === undefined ? [] : ['--test-list', testList]),
    ...passthrough,
];

/**
 * The Playwright arguments of one lane: the caller's selection, sharded.
 *
 * @param lane - Which lane, of how many.
 * @param passthrough - The caller's own arguments (spec files, `--grep`, ...).
 * @param testList - A `--test-list` file, if one was given.
 * @returns The arguments.
 */
export function laneArgs(lane: Lane, passthrough: readonly string[], testList?: string): readonly string[] {
    return [
        ...selection(passthrough, testList),
        `--shard=${lane.index}/${lane.count}`,
        `--output=test-results/lane-${lane.index}`,
    ];
}

/**
 * Picks `count` different ports.
 *
 * @param count - How many.
 * @param isTaken - Whether something already listens on a port.
 * @returns The ports, lowest first.
 * @throws When the range holds fewer than `count` free ports.
 */
export function distinctPorts(count: number, isTaken: (port: number) => boolean): readonly number[] {
    const ports: number[] = [];

    for (let port = PORT_RANGE.first; port <= PORT_RANGE.last && ports.length < count; port += 1) {
        if (!isTaken(port)) {
            ports.push(port);
        }
    }

    if (ports.length < count) {
        throw new Error(`error: ${count} lanes need ${count} free ports in ${PORT_RANGE.first}-${PORT_RANGE.last}`);
    }

    return ports;
}

const reportTestSchema = z.object({ projectName: z.string(), status: z.string() });
const reportSpecSchema = z.object({ title: z.string(), file: z.string().optional(), tests: z.array(reportTestSchema) });
interface ReportSuite {
    readonly title: string;
    readonly file?: string | undefined;
    readonly specs?: readonly z.infer<typeof reportSpecSchema>[] | undefined;
    readonly suites?: readonly ReportSuite[] | undefined;
}
const reportSuiteSchema: z.ZodType<ReportSuite> = z.lazy(() =>
    z.object({
        title: z.string(),
        file: z.string().optional(),
        specs: z.array(reportSpecSchema).optional(),
        suites: z.array(reportSuiteSchema).optional(),
    }),
);
const reportSchema = z.object({ suites: z.array(reportSuiteSchema) });
/** The part of Playwright's JSON report this script reads. */
export type PlaywrightReport = z.infer<typeof reportSchema>;

/**
 * Reads a Playwright JSON report.
 *
 * @param text - The report file's text.
 * @returns The report.
 * @throws When the text is not a report. A parse that quietly answered "no tests" would pass the count check.
 */
export const parseReport = (text: string): PlaywrightReport => reportSchema.parse(JSON.parse(text));

export interface ReportedTest {
    readonly project: string;
    /** `project › file › describe › title`, the form `--list` prints. */
    readonly id: string;
    readonly status: string;
}

const walk = (suite: ReportSuite, path: readonly string[]): readonly ReportedTest[] => {
    const here = [...path, suite.title];

    return [
        ...(suite.specs ?? []).flatMap((spec) =>
            spec.tests.map((test) => ({
                project: test.projectName,
                id: [test.projectName, ...here, spec.title].join(' › '),
                status: test.status,
            })),
        ),
        ...(suite.suites ?? []).flatMap((child) => walk(child, here)),
    ];
};

/**
 * Every test in a Playwright JSON report.
 *
 * @param report - The parsed report.
 * @returns One entry per test per project.
 */
export const flattenReport = (report: PlaywrightReport): readonly ReportedTest[] =>
    report.suites.flatMap((suite) => walk(suite, []));

/**
 * How many tests a report holds, `setup` left out.
 *
 * @param report - The parsed report.
 * @returns The count.
 */
export const countTests = (report: PlaywrightReport): number =>
    flattenReport(report).filter((test) => test.project !== 'setup').length;

/**
 * The verdict over every lane.
 *
 * @param input - The count listed before the run, the count merged after it, and each lane's exit code.
 * @returns The exit code (the worst lane's, or 1 when the counts differ) and what was wrong.
 */
export function verdict(input: {
    readonly listed: number;
    readonly merged: number;
    readonly laneCodes: readonly (number | null)[];
}): { readonly exitCode: number; readonly problems: readonly string[] } {
    const problems: string[] = [];
    const codes = input.laneCodes.map((code) => code ?? 1);

    if (input.laneCodes.some((code) => code === null)) {
        problems.push('a lane was killed by a signal');
    }

    if (input.merged !== input.listed) {
        problems.push(`the merged report holds ${input.merged} tests but ${input.listed} were listed`);
    }

    const worst = Math.max(0, ...codes);

    return { exitCode: worst === 0 && problems.length > 0 ? 1 : worst, problems };
}

/**
 * Whether this run should ask the selector which specs to run.
 *
 * Only a bare local run does. A caller that named a spec, set a test list, or forced the whole suite has already
 * chosen, and the selector must not override it.
 *
 * @param passthrough - The arguments after `npm run test:e2e --`.
 * @param env - The caller's environment.
 * @returns True when the selector decides.
 */
export const wantsSelection = (passthrough: readonly string[], env: Env): boolean =>
    passthrough.length === 0 && env['FULL_SUITE'] !== '1' && (env['E2E_TEST_LIST'] ?? '') === '';

/**
 * Playwright file filters that match exactly the named specs.
 *
 * Playwright reads a positional argument as a regular expression matched anywhere in the path, so a bare
 * `home.spec.ts` would also match `older/home.spec.ts` and `home.spec.tsx`; each filter is escaped, starts at the
 * test folder and ends at the file name.
 *
 * @param ids - Spec paths under `tests/e2e`.
 * @returns One filter per spec.
 */
export const specFilters = (ids: readonly string[]): readonly string[] =>
    ids.map((id) => `tests/e2e/${id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`);

/**
 * The text of a `--test-list` file for the listed tests: `[project] › file › describe › title`, one per line.
 *
 * `setup` is left out because Playwright runs it as a dependency of every project that needs it.
 *
 * @param tests - The tests of a `--list` report.
 * @returns The file text.
 */
export const testListText = (tests: readonly ReportedTest[]): string =>
    tests
        .filter((test) => test.project !== 'setup')
        .map((test) => `[${test.project}] › ${test.id.slice(test.project.length + ' › '.length)}\n`)
        .join('');

// ── The impure part ──────────────────────────────────────────────────────────────────────────────────

const sleep = (seconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

const run = (command: string, args: readonly string[], env: Env): number =>
    spawnSync(command, args, { stdio: 'inherit', env: env as NodeJS.ProcessEnv }).status ?? 1;

/**
 * Lists the tests a run would execute.
 *
 * @sideEffect Runs `playwright test --list`, which writes its JSON report to a file: stdout also carries whatever
 * the config prints while it loads.
 */
function listTests(passthrough: readonly string[], testList: string | undefined, env: Env): PlaywrightReport {
    mkdirSync(LANE_LOG_DIR, { recursive: true });

    const file = `${LANE_LOG_DIR}/listed.json`;
    const status = run(
        'npx',
        ['playwright', 'test', '--list', '--reporter=json', ...selection(passthrough, testList)],
        { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: file },
    );

    if (status !== 0) {
        throw new Error('error: playwright --list failed');
    }

    return parseReport(readFileSync(file, 'utf8'));
}

/** What step 1 decided about which specs to run, before the list is written. */
export type Decision =
    /** Run what Playwright was going to run anyway; `note` says why the selection was dropped, if it was. */
    | { readonly kind: 'unselected'; readonly note?: string }
    /** The change touches no spec's screens: run nothing, and say why. */
    | { readonly kind: 'none'; readonly why: string }
    /** Run exactly these tests. */
    | { readonly kind: 'list'; readonly specs: number; readonly tests: readonly ReportedTest[] };

/** What step 1 decided, with the list written. */
export type Choice =
    | Exclude<Decision, { kind: 'list' }>
    /** Run exactly the tests in this `--test-list` file. */
    | { readonly kind: 'list'; readonly file: string; readonly specs: number; readonly tests: number };

/**
 * Step 1's decision, as a pure function of the selector's answer and of what Playwright lists.
 *
 * Every branch that is not a plain "these specs" widens: a selection that lists nothing is a skipped test that looks
 * like a pass, so it runs every spec instead of none.
 *
 * @param web - The selector's answer for the web tier.
 * @param list - Lists the tests of the named specs (`playwright test --list`); may throw.
 * @returns What to run.
 */
export function decideSpecs(
    web:
        | { readonly kind: 'all'; readonly reasons: readonly string[] }
        | { readonly kind: 'some'; readonly ids: readonly string[] },
    list: (ids: readonly string[]) => readonly ReportedTest[],
): Decision {
    if (web.kind === 'all') {
        return { kind: 'unselected' };
    }

    if (web.ids.length === 0) {
        return { kind: 'none', why: 'no change touches a screen or a test that a web spec covers' };
    }

    let tests: readonly ReportedTest[];

    try {
        tests = list(web.ids).filter((test) => test.project !== 'setup');
    } catch (error) {
        return {
            kind: 'unselected',
            note: `could not list the selected specs (${error instanceof Error ? error.message : String(error)})`,
        };
    }

    const listed = new Set(tests.map((test) => test.id.split(' › ')[1]));
    const silent = web.ids.filter((id) => !listed.has(id));

    if (silent.length > 0) {
        return {
            kind: 'unselected',
            note: `the selected spec(s) ${silent.join(', ')} list no test in this configuration, so the selection cannot be trusted`,
        };
    }

    return { kind: 'list', specs: web.ids.length, tests };
}

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../..');

/**
 * Step 1: asks the impacted-test selector which specs the change affects.
 *
 * Fails SAFE: if the selector cannot answer, the whole suite runs.
 *
 * @sideEffect Runs the selector (git, dependency-cruiser) and `playwright test --list`, and writes the test list.
 * @param passthrough - The arguments after `npm run test:e2e --`.
 * @param env - The caller's environment.
 * @returns What to run.
 */
export async function chooseSelection(passthrough: readonly string[], env: Env): Promise<Choice> {
    if (!wantsSelection(passthrough, env)) {
        return { kind: 'unselected' };
    }

    let plan: Awaited<ReturnType<typeof runPlan>>;

    try {
        plan = await runPlan(REPO_ROOT, env as NodeJS.ProcessEnv);
    } catch (error) {
        console.warn(
            `warning: the selector could not run (${error instanceof Error ? error.message : String(error)}); running every spec`,
        );

        return { kind: 'unselected' };
    }

    plan.warnings.forEach((warning) => console.warn(`warning: ${warning}`));

    if (plan.web.kind === 'all') {
        console.log(
            `▶ selection      : every spec (${plan.web.reasons.length} reason${plan.web.reasons.length === 1 ? '' : 's'})`,
        );
        plan.web.reasons.slice(0, 5).forEach((reason) => console.log(`    ${reason}`));
    }

    const decision = decideSpecs(plan.web, (ids) => flattenReport(listTests(specFilters(ids), undefined, env)));

    if (decision.kind === 'unselected' && decision.note !== undefined) {
        console.warn(`warning: ${decision.note}; running every spec`);
    }

    if (decision.kind !== 'list') {
        return decision;
    }

    mkdirSync(LANE_LOG_DIR, { recursive: true });

    const file = `${LANE_LOG_DIR}/selected.txt`;

    writeFileSync(file, testListText(decision.tests));

    return { kind: 'list', file, specs: decision.specs, tests: decision.tests.length };
}

/** Where the route recorder (`tests/e2e/utils/routeRecorder.ts`) writes, one file per lane. */
const ROUTES_DIR = 'test-results/routes';

/**
 * After a run: checks the routes the specs really visited against the registry, and fails the run when a row must
 * grow. A row is never shrunk automatically.
 *
 * @sideEffect Reads the record files and the registry, and prints.
 * @param code - The run's own exit code.
 * @returns The code, or 1 when the run passed but a registry row is missing a screen.
 */
export function afterRun(code: number): number {
    try {
        const check = checkRecordedRoutes(REPO_ROOT, ROUTES_DIR);

        if (check.recorded === 0) {
            console.warn('warning: no navigation was recorded, so the spec registry was not checked against this run');

            return code;
        }

        console.log(`▶ routes recorded: ${check.recorded} ${JSON.stringify(check.kinds)}`);

        if (check.missing.length === 0) {
            return code;
        }

        console.error(
            `error: ${check.missing.length} spec(s) visited a screen their registry row leaves out. A change to that screen would not run them. Add:\n${check.text}`,
        );

        return code === 0 ? 1 : code;
    } catch (error) {
        console.warn(
            `warning: could not check the recorded routes (${error instanceof Error ? error.message : String(error)})`,
        );

        return code;
    }
}

const memAvailableBytes = (): number => {
    const line = readFileSync('/proc/meminfo', 'utf8')
        .split('\n')
        .find((entry) => entry.startsWith('MemAvailable:'));

    return Number(line?.match(/\d+/u)?.[0] ?? 0) * 1024;
};

const listeningPorts = (): ReadonlySet<number> => {
    const output = spawnSync('ss', ['-ltn'], { encoding: 'utf8' }).stdout;

    return new Set([...output.matchAll(/:(\d+)\s/gu)].map((match) => Number(match[1])));
};

const waitForExit = (child: ChildProcess): Promise<number | null> =>
    new Promise((resolve) => {
        child.on('exit', (code) => resolve(code));
        child.on('error', () => resolve(1));
    });

/**
 * @sideEffect Runs the suite and exits the process.
 * @param passthrough - The arguments after `npm run test:e2e --`.
 * @param env - The caller's environment.
 * @returns The exit code.
 */
export async function main(passthrough: readonly string[], env: Env): Promise<number> {
    const choice = await chooseSelection(passthrough, env);

    if (choice.kind === 'none') {
        console.log(`▶ nothing to run : ${choice.why}`);

        return 0;
    }

    if (choice.kind === 'list') {
        console.log(
            `▶ selection      : ${choice.specs} spec(s), ${choice.tests} test(s); FULL_SUITE=1 runs everything`,
        );
    }

    const testList = choice.kind === 'list' ? choice.file : env['E2E_TEST_LIST'];
    rmSync(ROUTES_DIR, { recursive: true, force: true });

    const single = (): number =>
        afterRun(run('bash', ['scripts/e2eLocal.sh', ...selection(passthrough, testList)], env));

    if (env['E2E_WEB_SERVER'] === 'dev' || env['E2E_LANES'] === '1') {
        return single();
    }

    const listed = countTests(listTests(passthrough, testList, env));
    const requested = env['E2E_LANES'] === undefined ? undefined : Number(env['E2E_LANES']);
    const plan = planLanes({
        cpus: cpus().length,
        load1: loadavg()[0] ?? 0,
        memAvailable: memAvailableBytes(),
        perLane: LANE_COST,
        identityCap: POOL_ROSTER.web.length,
        clerkCap: WEB_LANE_CLERK_CEILING,
        work: listed,
        requested,
    });

    console.log(`▶ lanes          : ${plan.count} (bound by ${plan.boundBy}; caps ${JSON.stringify(plan.caps)})`);
    console.log(`▶ tests listed   : ${listed}`);

    if (plan.count === 0) {
        console.log('▶ nothing to run');

        return 0;
    }

    if (plan.count === 1) {
        return single();
    }

    rmSync(BLOB_DIR, { recursive: true, force: true });
    mkdirSync(LANE_LOG_DIR, { recursive: true });

    const built = run('bash', ['scripts/e2eLocal.sh'], buildEnv(env));

    if (built !== 0) {
        console.error('error: the shared build failed');

        return built;
    }

    const taken = listeningPorts();
    const ports = distinctPorts(plan.count, (port) => taken.has(port));
    const stagger = Number(env['E2E_LANE_STAGGER_SECONDS'] ?? 3);
    const exits: Promise<number | null>[] = [];

    for (const [offset, port] of ports.entries()) {
        const lane = { index: offset + 1, count: plan.count };
        const log = openSync(`${LANE_LOG_DIR}/lane-${lane.index}.log`, 'w');
        const child = spawn('bash', ['scripts/e2eLocal.sh', ...laneArgs(lane, passthrough, testList)], {
            env: laneEnv(env, { ...lane, port }) as NodeJS.ProcessEnv,
            stdio: ['ignore', log, log],
        });

        console.log(
            `▶ lane ${lane.index}/${lane.count}     : port ${port}, log ${LANE_LOG_DIR}/lane-${lane.index}.log`,
        );
        exits.push(waitForExit(child));
        await sleep(stagger);
    }

    const laneCodes = await Promise.all(exits);
    const mergedDir = `${BLOB_DIR}/merged`;
    const mergedFile = `${LANE_LOG_DIR}/merged.json`;

    mkdirSync(mergedDir, { recursive: true });

    for (const lane of readdirSync(BLOB_DIR).filter((entry) => entry.startsWith('lane-'))) {
        for (const zip of readdirSync(`${BLOB_DIR}/${lane}`).filter((entry) => entry.endsWith('.zip'))) {
            cpSync(`${BLOB_DIR}/${lane}/${zip}`, `${mergedDir}/${zip}`);
        }
    }

    const merged = run('npx', ['playwright', 'merge-reports', '--reporter=json', mergedDir], {
        ...env,
        PLAYWRIGHT_JSON_OUTPUT_FILE: mergedFile,
    });
    const report = merged === 0 ? parseReport(readFileSync(mergedFile, 'utf8')) : { suites: [] };

    const tests = flattenReport(report).filter((test) => test.project !== 'setup');
    const result = verdict({ listed, merged: tests.length, laneCodes });

    for (const status of ['expected', 'unexpected', 'flaky', 'skipped']) {
        console.log(`▶ ${status.padEnd(10)} : ${tests.filter((test) => test.status === status).length}`);
    }

    for (const test of tests.filter((entry) => entry.status === 'unexpected' || entry.status === 'flaky')) {
        console.log(`  ${test.status}: ${test.id}`);
    }

    for (const problem of result.problems) {
        console.error(`error: ${problem}`);
    }

    console.log(`▶ lane exit codes: ${laneCodes.join(' ')}   (merged report: ${mergedFile})`);

    return afterRun(result.exitCode);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
    main(process.argv.slice(2), process.env).then(
        (code) => process.exit(code),
        (error: unknown) => {
            console.error(error instanceof Error ? error.message : error);
            process.exit(1);
        },
    );
}
