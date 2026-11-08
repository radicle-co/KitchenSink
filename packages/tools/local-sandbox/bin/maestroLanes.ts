/**
 * `npm run maestro:lanes -- --platform android|ios|both [--lanes <n>] [--flows <f...>]` — the local Maestro lane
 * orchestrator: N emulators, each running one run-mode `runMaestroFlows.sh` lane against the local sandbox, under one
 * host-owned set of shared services. `FULL_SUITE=1` runs the whole suite; with no `--flows` the impact selector picks.
 *
 * ⛔ A LOCAL e2e run (docs/CODING_STANDARDS.md §7.1a): it proves the app and the flows against this tree's services and
 * nothing about a deploy. It creates NO lane user: the lanes it can run are the lanes whose users exist
 * (`poolAdmin --list-local-lanes`), and adding one is the owner's `poolAdmin --apply --maestro-lane` run. The one Clerk
 * user it makes is each platform's erasure subject, which exists only during the run: `runUsers.ts` records its id in
 * `runUsers.<platform>.json` beside the lock, and the run deletes that id and no other when it ends.
 *
 * The run's order and its exits are `src/maestroLanes/laneRun.ts`; this file only wires the real world into it. The
 * toolchain, the Clerk keys, the LocalStack pin and the seed tools' settings come from `localMaestro.sh`'s own functions,
 * so each is stated once.
 *
 * @sideEffect Boots emulators, starts the queue consumers and the parse worker, resets the local pool, runs Maestro.
 */
import { execFile, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';

import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { clerkPoolAdminPort, listLocalLanes } from '@kitchensink/e2e-fixtures/poolAdmin';
import { checkRecordedScreens, flowOutcomes } from '@kitchensink/e2e-plan/recordedScreens';
import { runPlan } from '@kitchensink/e2e-plan/runPlan';
import { settleStamp, stateRoot, type Env, type StampStart } from '@kitchensink/e2e-plan/stampRun';

import { createAndroidAdapter } from '../src/maestroLanes/androidAdapter.js';
import { consolePort } from '../src/maestroLanes/androidSerials.js';
import { createMacAndroidHost } from '../src/maestroLanes/macAndroidHost.js';
import { IosAdapter } from '../src/maestroLanes/iosAdapter.js';
import { createIosShell } from '../src/maestroLanes/iosShell.js';
import { acquireHostLock, currentBootId, pidIsAlive } from '../src/maestroLanes/hostLock.js';
import { parseLaneArgs, platformTurns, type LaneArgs } from '../src/maestroLanes/lanePlanning.js';
import { SCREEN_RECORD_FILE, spawnRunner, type LaneChild } from '../src/maestroLanes/laneProcess.js';
import { runLaneRun, type LaneRunDeps, type Selection } from '../src/maestroLanes/laneRun.js';
import { emptyUsage, laneProcesses, parsePs, recordSample, summarizeUsage } from '../src/maestroLanes/laneUsage.js';
import type { CommandPort, DeviceAdapter, LanePlatform, LaneSpec } from '../src/maestroLanes/laneTypes.js';
import { CONSUMER_PLAN_RELATIVE, readConsumerPlan } from '../src/queueConsumers.js';
import { parseLocalSettings, type LocalSettings } from '../src/maestroLanes/localSettings.js';
import { startSharedServices, type RunningService, type ServiceSpec } from '../src/maestroLanes/sharedServices.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const LOCAL_MAESTRO = path.join(REPO_ROOT, 'packages/tools/local-sandbox/bin/localMaestro.sh');
const RUNNER = path.join(REPO_ROOT, 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh');
/** `localMaestro.sh`'s default state folder too; `localSettings.test.ts` holds the two equal. */
const STATE_DIR = path.join(stateRoot(), 'localMaestro');
/** Where the screen check writes one JSON report per platform, for the flow-row narrowing script. */
const SCREEN_EVIDENCE_DIR = path.join(stateRoot(), 'screenEvidence');
/** The door that makes and deletes the run's own Clerk users, by recorded id; `localMaestro.sh` uses the same one. */
const RUN_USERS = 'packages/tools/e2e-fixtures/src/runUsers.ts';

/** The run's record of the users it made: beside the lock, and the file `localMaestro.sh`'s door uses too. */
const runUserRecord = (platform: LanePlatform): string => path.join(STATE_DIR, `runUsers.${platform}.json`);

/**
 * The environment every lane starts from: `localMaestro.sh`'s toolchain, Clerk keys, LocalStack pin and seed settings,
 * read back as one `env -0`. The keys travel in memory only.
 *
 * @sideEffect Runs bash; may read the sandbox Clerk secret from real AWS once (cached by `localMaestro.sh`).
 */
function baseEnvironment(): Env {
    const result = spawnSync(
        'bash',
        [
            '-c',
            '. "$1" && cd "$2" && local_maestro_toolchain >&2 && local_maestro_load_clerk_keys >&2 && local_maestro_pin_aws && ' +
                'local_maestro_seed_env "$3" && local_maestro_require_services >&2 && ' +
                'export MAESTRO_LOCAL_RECIPE_HOST_PORT="$LOCAL_MAESTRO_RECIPE_HOST_PORT" && env -0',
            'maestroLanes',
            LOCAL_MAESTRO,
            REPO_ROOT,
            STATE_DIR,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 16 * 1024 * 1024 },
    );

    if (result.status !== 0) {
        throw new Error('maestro:lanes: the local environment is not ready (see above)');
    }

    // `localMaestro.sh` pins its one emulator through ANDROID_SERIAL; a lane's device comes from its adapter.
    return Object.fromEntries(
        result.stdout
            .split('\0')
            .filter((pair) => pair.includes('=') && !pair.startsWith('ANDROID_SERIAL='))
            .map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]),
    );
}

/**
 * The local stack's facts (the AVD, the origins, LocalStack, the service patterns), from their one home,
 * `localMaestro.sh`.
 *
 * @sideEffect Runs bash.
 */
function readLocalSettings(): LocalSettings {
    const result = spawnSync('bash', ['-c', '. "$1" && local_maestro_settings', 'maestroLanes', LOCAL_MAESTRO], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
    });

    if (result.status !== 0) {
        throw new Error('maestro:lanes: localMaestro.sh did not print its settings (see above)');
    }

    return parseLocalSettings(result.stdout);
}

/** Run a command to completion. Never throws for a non-zero exit; the caller reads the code. */
function run(command: string, args: readonly string[], options: { env?: Env; cwd?: string } = {}) {
    return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
        execFile(
            command,
            [...args],
            { env: options.env, cwd: options.cwd ?? REPO_ROOT, maxBuffer: 64 * 1024 * 1024 },
            (error, stdout, stderr) => {
                const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
                resolve({ code, stdout, stderr });
            },
        );
    });
}

/** Start a process in its own group, logging to a file. */
function spawnDetached(
    command: string,
    args: readonly string[],
    log: string,
    env?: Env,
    cwd = REPO_ROOT,
): { pid: number } {
    const fd = openSync(log, 'w');
    const child = spawn(command, [...args], { env, cwd, stdio: ['ignore', fd, fd], detached: true });
    closeSync(fd);
    child.unref();

    return { pid: child.pid ?? -1 };
}

function killGroup(pid: number): void {
    try {
        process.kill(-pid, 'SIGTERM');
    } catch {
        // Already gone.
    }
}

/**
 * The adapter for a platform. iOS and the Mac's Android refuse to build without `LOCAL_MAESTRO_IOS_HOST` (the variable's name
 * is kept for now: it names the Mac). Android runs on the Mac unless `LOCAL_MAESTRO_ANDROID_ON=wsl`.
 */
function adapterFor(platform: LanePlatform, env: Env, settings: LocalSettings): DeviceAdapter {
    if (platform === 'ios') {
        return new IosAdapter({ shell: createIosShell(), env, repoRoot: REPO_ROOT, settings });
    }

    const commands: CommandPort = {
        run: (command, args, options) => run(command, args, { env: options?.env ?? env, cwd: options?.cwd }),
        spawnDetached: (command, args, log) => spawnDetached(command, args, log, env),
        killGroup,
        sleep: async (ms) => {
            await delay(ms);
        },
        readFile: (file) => (existsSync(file) ? readFileSync(file, 'utf8') : undefined),
    };

    const host =
        settings.androidOn === 'mac'
            ? createMacAndroidHost({
                  shell: createIosShell(),
                  env,
                  repoRoot: REPO_ROOT,
                  settings,
                  readFile: commands.readFile,
              })
            : undefined;

    return createAndroidAdapter({
        repoRoot: REPO_ROOT,
        avd: settings.avd,
        avdConfig: settings.avdConfig,
        avdImage: settings.avdImage,
        ...(host === undefined ? {} : { host }),
        recipeOrigin: settings.recipeOrigin,
        identityOrigin: settings.identityOrigin,
        foodOrigin: settings.foodOrigin,
        publishableKey: env['CLERK_PUBLISHABLE_KEY'] ?? '',
        commands,
        bootTimeoutMs: 300_000,
        environment: env,
    });
}

/**
 * The checkout that started the running local stack: `local:up` runs compose from `<checkout>/.local-sandbox`, and the
 * queue consumers' plan and code belong to that checkout, not to whichever tree runs the lanes.
 *
 * @sideEffect Runs `docker inspect`.
 */
function stackRoot(): string {
    const label = spawnSync(
        'docker',
        [
            'inspect',
            'local-sandbox-recipes',
            '--format',
            '{{index .Config.Labels "com.docker.compose.project.working_dir"}}',
        ],
        { encoding: 'utf8' },
    ).stdout.trim();

    if (label === '') {
        throw new Error('maestro:lanes: no local stack is running - run `npm run local:up` first');
    }

    return path.dirname(label);
}

/** The services a lane run owns: every queue consumer the running stack planned, and the parse worker. */
function serviceSpecs(root: string, settings: LocalSettings): readonly ServiceSpec[] {
    const consumers = readConsumerPlan(path.join(root, CONSUMER_PLAN_RELATIVE)).map(
        ({ name, queueUrl }): ServiceSpec => ({
            name,
            queueUrl,
            pattern: settings.consumerPattern(name),
            command: 'npx',
            args: ['tsx', 'packages/tools/local-sandbox/bin/queueConsumer.ts', name],
        }),
    );

    return [
        ...consumers,
        {
            name: 'parseWorker',
            pattern: settings.workerPattern,
            command: 'npm',
            args: ['run', 'dev', '--workspace=@kitchensink/recipe-workers'],
        },
    ];
}

/** Start one service and wait until it is ready: a consumer prints `draining`, the worker is alive after 8 s. */
async function startService(spec: ServiceSpec, env: Env, root: string): Promise<RunningService> {
    const log = path.join(STATE_DIR, `service.${spec.name}.log`);
    const { pid } = spawnDetached(spec.command, spec.args, log, env, root);
    const consumer = spec.name !== 'parseWorker';

    for (let waited = 0; waited < 60; waited += 1) {
        await delay(1_000);

        if (!pidIsAlive(pid)) {
            throw new Error(`maestro:lanes: ${spec.name} exited - log: ${log}`);
        }

        if (consumer ? readFileSync(log, 'utf8').includes('draining') : waited >= 8) {
            return {
                pid,
                stop: async () => {
                    killGroup(pid);

                    for (let tries = 0; tries < 10 && pidIsAlive(pid); tries += 1) {
                        await delay(1_000);
                    }

                    try {
                        process.kill(-pid, 'SIGKILL');
                    } catch {
                        // Gone.
                    }
                },
            };
        }
    }

    killGroup(pid);
    throw new Error(`maestro:lanes: ${spec.name} was not ready in 60 s - log: ${log}`);
}

const laneEnvFor = (base: Env, lane: LaneSpec): Env => ({
    ...base,
    MAESTRO_PLATFORM: lane.platform,
    COMMISE_E2E_SHARD: String(lane.index),
    E2E_SEED_STATE_DIR: lane.stateDir,
});

/** Run a seed or pool tool for one lane, failing loudly. */
async function tool(env: Env, what: string, args: readonly string[]): Promise<string> {
    const outcome = await run('npx', ['tsx', ...args], { env });

    if (outcome.code !== 0) {
        process.stderr.write(outcome.stderr);
        throw new Error(`maestro:lanes: ${what} failed`);
    }

    return outcome.stdout;
}

/** What the runner selects for this platform's lanes, after its platform and local filters. */
async function selectFlows(base: Env, platform: LanePlatform, selector: string) {
    const outcome = await run('bash', [RUNNER, 'shard-selection', '1', '1', ...selector.split(' ').filter(Boolean)], {
        env: { ...base, MAESTRO_PLATFORM: platform, MAESTRO_LOCAL: '1' },
    });
    const values = (key: string) =>
        outcome.stdout.split('\n').flatMap((line) => (line.startsWith(`${key}=`) ? [line.slice(key.length + 1)] : []));

    if (outcome.code !== 0) {
        if (/can (run|serve) NONE/u.test(outcome.stderr)) {
            return { flows: [], notes: [outcome.stderr.trim()], owed: [] };
        }

        throw new Error(`maestro:lanes: the runner could not select flows: ${outcome.stderr.trim()}`);
    }

    return {
        flows: values('flow'),
        owed: values('needs-sandbox').map((row) => row.split('|')[0] ?? ''),
        notes: [
            ...values('needs-sandbox').map((row) => `not run locally: needs sandbox - ${row.replace('|', ' (')})`),
            ...values('excluded').map((flow) => `excluded on ${platform}: ${flow}`),
        ],
    };
}

/** What the selector said for one platform, and where its green stamp stood when it said it. */
interface PlatformChoice {
    readonly selection: Selection;
    /** Set only when the selector chose the set (a forced full suite counts); a list named on the command line has none. */
    readonly start?: StampStart;
}

/**
 * The selection of each platform: the flows named on the command line for all of them, or the impact selector's answer
 * for each (FULL_SUITE asks it too, for the stamp's tree; the selector answers `all`). A selector that fails runs
 * everything and moves no stamp.
 *
 * @sideEffect Runs the selector once per platform.
 */
async function resolveSelection(
    args: LaneArgs,
    env: Env,
    log: (line: string) => void,
): Promise<ReadonlyMap<LanePlatform, PlatformChoice>> {
    const choices = new Map<LanePlatform, PlatformChoice>();

    for (const platform of args.platforms) {
        if (args.selection !== 'changed' && args.selection !== 'all') {
            choices.set(platform, { selection: args.selection });
            continue;
        }

        try {
            const plan = await runPlan(REPO_ROOT, env, { platform });

            plan.warnings.forEach((warning) => log(`warning: ${warning}`));

            choices.set(platform, {
                selection: plan.mobile.kind === 'all' ? 'all' : plan.mobile.ids,
                ...(plan.treeAtStart === null
                    ? {}
                    : { start: { planTree: plan.treeAtStart, previous: plan.previous ?? undefined } }),
            });
        } catch (error) {
            log(`the impact selector failed on ${platform}, so every flow runs (${String(error)})`);
            choices.set(platform, { selection: 'all' });
        }
    }

    return choices;
}

/**
 * Start the shared services for the run, then build the downgraded owner's world (`recipes/makePublicConfirm` reads
 * it); building it creates no user.
 *
 * @sideEffect Starts the queue consumers and the parse worker; writes the local recipe world.
 */
async function startServices(base: Env, settings: LocalSettings) {
    const root = stackRoot();
    const sqs = new SQSClient({
        endpoint: settings.localstack,
        region: 'us-east-1',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    const services = await startSharedServices(serviceSpecs(root, settings), {
        listProcesses: async () =>
            (await run('ps', ['-eo', 'pid=,args='])).stdout
                .split('\n')
                .map((line) => /^\s*(\d+)\s+(.*)$/u.exec(line))
                .flatMap((match) => (match === null ? [] : [{ pid: Number(match[1]), command: match[2] ?? '' }]))
                .filter((entry) => entry.pid !== process.pid),
        unusableBecause: async (spec) => {
            if (spec.queueUrl === undefined) {
                return undefined;
            }

            try {
                await sqs.send(
                    new GetQueueAttributesCommand({ QueueUrl: spec.queueUrl, AttributeNames: ['QueueArn'] }),
                );

                return undefined;
            } catch (error) {
                return `its queue ${spec.queueUrl} is not in LocalStack (${error instanceof Error ? error.name : String(error)})`;
            }
        },
        start: (spec) => startService(spec, base, root),
        resetPool: async (lane) => {
            await tool(laneEnvFor(base, lane), `the pool reset of lane ${lane.platform}-${lane.index}`, [
                'packages/tools/e2e-seed/src/resetPool.ts',
                '--tier',
                'maestro',
                '--platform',
                lane.platform,
                '--shard',
                String(lane.index),
            ]);
        },
    });
    const built = await run('npm', ['run', 'ensure-downgraded', '--workspace=packages/tools/e2e-seed'], {
        env: { ...base, E2E_ROLE_USERS_NAMESPACE: 'shared' },
    });

    if (built.code !== 0) {
        process.stderr.write(built.stderr);
        await services.stop([]);
        throw new Error('maestro:lanes: the downgraded owner world could not be built');
    }

    return services;
}

/**
 * Sample each live lane's processes every few seconds into `<lane>/usage.tsv`, and log each lane's mean CPUs and peak
 * memory when it ends: the measurement behind an adapter's `laneCost`.
 *
 * @sideEffect Runs `ps` on a timer and writes the lane's usage file.
 */
function watchUsage(lane: LaneSpec, child: LaneChild, log: (line: string) => void): void {
    let usage = emptyUsage();
    const file = path.join(lane.stateDir, 'usage.tsv');
    writeFileSync(file, 'epochMs\tcpuSeconds\trssKb\n');

    const sample = (): void => {
        const rows = laneProcesses(
            parsePs(spawnSync('ps', ['-eo', 'pid=,pgid=,times=,rss=,args='], { encoding: 'utf8' }).stdout),
            {
                runnerPgid: child.pid,
                consolePort: consolePort(lane.device),
            },
        );
        const at = Date.now();
        usage = recordSample(usage, rows, at);
        appendFileSync(file, `${at}\t${usage.cpuSeconds}\t${rows.reduce((sum, row) => sum + row.rssKb, 0)}\n`);
    };

    const timer = setInterval(sample, 5_000);
    sample();

    void child.exit.then(() => {
        clearInterval(timer);
        const { seconds, meanCpus, peakRssBytes } = summarizeUsage(usage);
        log(
            `lane ${lane.platform}-${lane.index} usage: ${meanCpus} CPUs mean, ${(peakRssBytes / 1024 ** 3).toFixed(1)} GiB peak, over ${Math.round(seconds)} s`,
        );
    });
}

async function main(argv: readonly string[]): Promise<number> {
    const args = parseLaneArgs(argv, process.env);
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    const settings = readLocalSettings();
    const androidHost = settings.androidOn;
    const base = baseEnvironment();
    // `listLocalLanes` and the lane slots read the namespace from this process.
    process.env['E2E_POOL_NAMESPACE'] = 'local';

    const log = (line: string): void => {
        process.stdout.write(`maestro:lanes: ${new Date().toISOString().slice(11, 19)} ${line}\n`);
    };

    const choices = await resolveSelection(args, base, log);

    const children = new Set<LaneChild>();
    let aborted = false;

    const abort = (): void => {
        aborted = true;

        for (const child of children) {
            child.stop();
        }
    };

    process.on('SIGINT', abort);
    process.on('SIGTERM', abort);

    const deps: LaneRunDeps = {
        adapterFor: (platform) => adapterFor(platform, base, settings),
        stateDir: STATE_DIR,
        // Sorts by age, and holds no `:` or `.` (a folder name on the Mac side of an rsync too).
        runStamp: new Date().toISOString().replace(/[:.]/gu, '-'),
        repoRoot: REPO_ROOT,
        lockDir: path.join(STATE_DIR, 'locks'),
        baseEnv: base,
        acquireLock: () =>
            acquireHostLock(path.join(STATE_DIR, 'maestroLanes.lock'), process.pid, pidIsAlive, currentBootId()),
        selectFlows: (platform, selector) => selectFlows(base, platform, selector),
        pack: async (platform, index, count, flows) => {
            const outcome = await run('bash', [RUNNER, 'pack', platform, String(index), String(count), ...flows]);

            if (outcome.code !== 0) {
                throw new Error(
                    `maestro:lanes: the runner could not pack lane ${index}/${count}: ${outcome.stderr.trim()}`,
                );
            }

            return outcome.stdout.split('\n').flatMap((line) => (line.startsWith('flow=') ? [line.slice(5)] : []));
        },
        identityCap: async (platform) =>
            (await listLocalLanes(clerkPoolAdminPort(base['CLERK_SECRET_KEY'] ?? ''), platform)).present,
        startServices: () => startServices(base, settings),
        createRunUsers: async (platforms) => {
            for (const platform of platforms) {
                const made = await tool(base, `making the ${platform} run erasure subject`, [
                    RUN_USERS,
                    '--create-run-erasure-subject',
                    '--platform',
                    platform,
                    '--record',
                    runUserRecord(platform),
                ]);
                log(made.trim());
            }
        },
        removeRunUsers: async (platforms) => {
            let failure: Error | undefined;

            // Every platform's record is tried, so one failure does not strand the other platform's subject.
            for (const platform of platforms) {
                try {
                    const deleted = await tool(base, `deleting the ${platform} run users`, [
                        RUN_USERS,
                        '--delete-run-users',
                        '--record',
                        runUserRecord(platform),
                    ]);
                    log(deleted.trim());
                } catch (error) {
                    failure ??= error instanceof Error ? error : new Error(inspect(error));
                }
            }

            if (failure !== undefined) {
                throw failure;
            }
        },
        setupLane: async (lane, env) => {
            await tool(env, `aligning lane ${lane.index}'s identities`, [
                'packages/tools/local-sandbox/bin/alignIdentities.ts',
            ]);
            const manifest = await tool(env, `provisioning lane ${lane.index}`, [
                'packages/tools/e2e-seed/src/provision.ts',
            ]);
            writeFileSync(lane.fixtureEnvFile, manifest, { mode: 0o600 });
        },
        spawnLane: (lane, env) => {
            const child = spawnRunner({
                script: RUNNER,
                cwd: REPO_ROOT,
                env,
                log: path.join(lane.stateDir, 'runner.log'),
            });
            children.add(child);
            void child.exit.then(() => children.delete(child));

            // The Mac's emulators are not WSL processes: `ps` here cannot see them (`maestro:macUsage` measures those).
            if (lane.platform === 'android' && androidHost === 'wsl') {
                watchUsage(lane, child, log);
            }

            return child;
        },
        checkScreens: (lanes) => {
            const report = checkRecordedScreens(
                REPO_ROOT,
                lanes.map((lane) => ({ platform: lane.platform, file: path.join(lane.stateDir, SCREEN_RECORD_FILE) })),
                SCREEN_EVIDENCE_DIR,
            );

            for (const line of report.text.split('\n').filter((text) => text !== '')) {
                log(line);
            }

            if (report.flows === 0) {
                log('no flow recorded a result, so the recorder did not run and no screen was checked');
            }

            return Promise.resolve({ code: report.failed ? 1 : 0, results: report.results });
        },
        settleStamp: (settlement) =>
            settleStamp({
                repo: REPO_ROOT,
                platform: settlement.platform,
                start: choices.get(settlement.platform)?.start,
                outcomes: flowOutcomes(settlement.flows, settlement.results),
                owed: settlement.owed,
                recorderClean: settlement.recorderClean,
                log,
            }),
        aborted: () => aborted,
        staggerMs: args.staggerSeconds * 1000,
        log,
    };

    // The Mac hosts one platform at a time: Android then iOS are two turns and the exit code is the worse of the two. A
    // turn that was stopped (SIGINT or SIGTERM) ends the run.
    let worst = 0;

    for (const platforms of platformTurns(args.platforms, androidHost)) {
        const code = await runLaneRun(deps, {
            platforms,
            requested: args.requested,
            selection: {
                android: choices.get('android')?.selection ?? 'all',
                ios: choices.get('ios')?.selection ?? 'all',
            },
        });
        worst = Math.max(worst, code);

        if (aborted) {
            break;
        }
    }

    return worst;
}

main(process.argv.slice(2)).then(
    (code) => {
        process.exitCode = code;
    },
    (error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    },
);
