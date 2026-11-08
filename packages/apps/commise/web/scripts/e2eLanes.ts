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
 * 3. Build ONCE (`E2E_BUILD_ONLY`). The three API origins are pinned to `DEAD_ORIGIN` (`e2eServer`) for the build AND for
 *    every lane, so the artifact does not depend on which port a lane gets and the turbo cache key is stable.
 * 4. Start the lanes (`E2E_SKIP_BUILD`), staggered, one log each.
 * 5. Merge the blob reports and compare the merged count with the listed count. A lane that died, or a shard that
 *    lost a file, leaves the others green; only that comparison notices.
 *
 * `E2E_LANES=1` or `E2E_WEB_SERVER=dev` gives the single run `e2eLocal.sh` always was.
 *
 * ## Where the parts live
 *
 * This file is the entry: the order of a run. The parts are modules beside it: `e2eSelection` (which specs), `e2eReport`
 * (reading Playwright's report, what the tests did), `e2eDurationTable` (balancing), `e2eServer` (the one shared server),
 * `e2eLaneSet` (the lanes), `e2eMachineLock` (one run per machine), `e2eEnv` and `@kitchensink/e2e-plan/hostMemory` (what the machine and the
 * caller give).
 *
 * ⚠️ `setup` re-runs in every lane that holds a test needing the shared session (that is correct: each lane signs in
 * as its own slot), so the counts below leave the `setup` project out.
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';

import { planLanes } from '@kitchensink/e2e-plan';
import { availableMemoryBytes } from '@kitchensink/e2e-plan/hostMemory';
import { checkRecordedRoutes } from '@kitchensink/e2e-plan/recordedRoutes';
import { settleStamp, type Env } from '@kitchensink/e2e-plan/stampRun';
import { POOL_ROSTER } from '@kitchensink/e2e-fixtures/testPool';

import { laneLists, loadDurations, medianMs } from './e2eDurationTable';
import { parseLaneRequest, parseStaggerSeconds } from './e2eEnv';
import {
    LANE_COST,
    SERVER_COST,
    WEB_LANE_CLERK_CEILING,
    buildEnv,
    distinctPorts,
    listeningPorts,
    mergeLaneReports,
    startLanes,
    MERGED_FILE,
} from './e2eLaneSet';
import { thisMachine, withWebLock } from './e2eMachineLock';
import { BLOB_DIR, DURATIONS_FILE, LANE_LOG_DIR, REPO_ROOT, ROUTES_DIR } from './e2ePaths';
import { run } from './e2eProcess';
import { countTests, flattenReport, outcomesOf, parseReport, verdict, type Outcomes } from './e2eReport';
import { chooseSelection, listTests, selection } from './e2eSelection';
import { startSharedServer, wantsSharedServer } from './e2eServer';

/** The counts of the single-lane run's JSON report, or undefined when it left none or an unreadable one. */
function singleOutcomes(file: string): Outcomes | undefined {
    try {
        return outcomesOf(flattenReport(parseReport(readFileSync(file, 'utf8'))));
    } catch {
        return undefined;
    }
}

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

/**
 * @sideEffect Runs the suite, takes the machine lock, and may move the green stamp.
 * @param passthrough - The arguments after `npm run test:e2e --`.
 * @param env - The caller's environment.
 * @returns The exit code.
 * @throws When `E2E_LANES` or `E2E_LANE_STAGGER_SECONDS` is not a valid value, or another web run holds the lock.
 */
export async function main(passthrough: readonly string[], env: Env): Promise<number> {
    const requested = parseLaneRequest(env);
    const staggerSeconds = parseStaggerSeconds(env);
    const { choice, start } = await chooseSelection(passthrough, env);
    const none: Outcomes = { passed: 0, failed: 0, skipped: 0, owed: [] };
    const settle = (outcomes: Outcomes | undefined, recorderClean: boolean): Promise<void> =>
        settleStamp({
            repo: REPO_ROOT,
            platform: 'web',
            start,
            outcomes,
            owed: outcomes?.owed ?? [],
            recorderClean,
            log: console.log,
        });

    if (choice.kind === 'none') {
        console.log(`▶ nothing to run : ${choice.why}`);
        await settle(none, true);

        return 0;
    }

    if (choice.kind === 'list') {
        console.log(
            `▶ selection      : ${choice.specs} spec(s), ${choice.tests} test(s); FULL_SUITE=1 runs everything`,
        );
    }

    const testList = choice.kind === 'list' ? choice.file : env['E2E_TEST_LIST'];

    return await withWebLock(thisMachine(env), async () => {
        rmSync(ROUTES_DIR, { recursive: true, force: true });

        const single = async (): Promise<number> => {
            // A second reporter writes the report the stamp counts from; the console keeps the list reporter.
            const reportFile = `${LANE_LOG_DIR}/single.json`;

            mkdirSync(LANE_LOG_DIR, { recursive: true });
            rmSync(reportFile, { force: true });

            const code = run('bash', ['scripts/e2eLocal.sh', ...selection(passthrough, testList)], {
                ...env,
                E2E_REPORTER: 'list,json',
                PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile,
            });
            const final = afterRun(code);

            await settle(singleOutcomes(reportFile), final === code);

            return final;
        };

        if (env['E2E_WEB_SERVER'] === 'dev' || requested === 1) {
            return await single();
        }

        const listReport = listTests(passthrough, testList, env);
        const listed = countTests(listReport);
        const plan = planLanes({
            cpus: cpus().length,
            load1: loadavg()[0] ?? 0,
            memAvailable: availableMemoryBytes(),
            perLane: LANE_COST,
            fixed: wantsSharedServer(env) ? SERVER_COST : undefined,
            identityCap: POOL_ROSTER.web.length,
            clerkCap: WEB_LANE_CLERK_CEILING,
            work: listed,
            requested,
        });

        console.log(`▶ lanes          : ${plan.count} (bound by ${plan.boundBy}; caps ${JSON.stringify(plan.caps)})`);
        console.log(`▶ tests listed   : ${listed}`);

        if (plan.count === 0) {
            console.log('▶ nothing to run');
            await settle(none, true);

            return 0;
        }

        if (plan.count === 1) {
            return await single();
        }

        rmSync(BLOB_DIR, { recursive: true, force: true });
        mkdirSync(LANE_LOG_DIR, { recursive: true });

        const built = run('bash', ['scripts/e2eLocal.sh'], buildEnv(env));

        if (built !== 0) {
            console.error('error: the shared build failed');

            return built;
        }

        const durations = loadDurations();
        const packing = laneLists(flattenReport(listReport), durations, plan.count, medianMs(durations));

        console.log(
            `▶ lane estimates : ${packing.estimateMs.map((ms) => `${(ms / 60000).toFixed(1)}m`).join(' ')}   (from ${DURATIONS_FILE})`,
        );

        if (packing.defaulted.length > 0) {
            console.warn(
                `warning: ${packing.defaulted.length} test(s) have no recorded duration and were given the median; refresh ${DURATIONS_FILE} with \`npm run e2e:durations\``,
            );
        }

        const taken = listeningPorts();
        const shared = wantsSharedServer(env);
        const ports = distinctPorts(shared ? 1 : packing.texts.length, (port) => taken.has(port));
        const server = shared ? await startSharedServer(env, ports[0] ?? 0) : undefined;
        const laneCodes = await startLanes({ env, texts: packing.texts, ports, shared, staggerSeconds });

        await server?.stop();

        const tests = flattenReport(mergeLaneReports(env)).filter((test) => test.project !== 'setup');
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

        console.log(`▶ lane exit codes: ${laneCodes.join(' ')}   (merged report: ${MERGED_FILE})`);

        const final = afterRun(result.exitCode);

        await settle(result.problems.length > 0 ? undefined : outcomesOf(tests), final === result.exitCode);

        return final;
    });
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
