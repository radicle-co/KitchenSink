/**
 * `npm run maestro:lanes -- --platform android|ios|both [--lanes <n>] [--flows <f...>]` — the local Maestro lane
 * orchestrator: N emulators, each running one run-mode `runMaestroFlows.sh` lane against the local sandbox, under one
 * host-owned set of shared services. `FULL_SUITE=1` runs the whole suite; with no `--flows` the impact selector picks.
 *
 * ⛔ A LOCAL e2e run (docs/CODING_STANDARDS.md §7.1a): it proves the app and the flows against this tree's services and
 * nothing about a deploy. It creates and deletes NO Clerk user: the lanes it can run are the lanes whose users exist
 * (`poolAdmin --list-local-lanes`), and adding one is the owner's `poolAdmin --apply --maestro-lane` run.
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

import { clerkPoolAdminPort, listLocalLanes } from '@kitchensink/e2e-fixtures/poolAdmin';
import { runPlan } from '@kitchensink/e2e-plan/runPlan';

import { createAndroidAdapter, type CommandPort } from '../src/maestroLanes/androidAdapter.js';
import { acquireHostLock, pidIsAlive } from '../src/maestroLanes/hostLock.js';
import { parseLaneArgs } from '../src/maestroLanes/lanePlanning.js';
import { spawnRunner, type Env, type LaneChild } from '../src/maestroLanes/laneProcess.js';
import { runLaneRun, type LaneRunDeps } from '../src/maestroLanes/laneRun.js';
import { emptyUsage, laneProcesses, parsePs, recordSample, summarizeUsage } from '../src/maestroLanes/laneUsage.js';
import type { DeviceAdapter, LanePlatform, LaneSpec } from '../src/maestroLanes/laneTypes.js';
import { startSharedServices, type RunningService, type ServiceSpec } from '../src/maestroLanes/sharedServices.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const LOCAL_MAESTRO = path.join(REPO_ROOT, 'packages/tools/local-sandbox/bin/localMaestro.sh');
const RUNNER = path.join(REPO_ROOT, 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh');
const CONSUMER_PLAN = path.join(REPO_ROOT, '.local-sandbox/queueConsumers.json');
const STATE_DIR = path.join(
    process.env['XDG_STATE_HOME'] ?? path.join(process.env['HOME'] ?? '', '.local/state'),
    'kitchensink/localMaestro',
);

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
function spawnDetached(command: string, args: readonly string[], log: string, env?: Env): { pid: number } {
    const fd = openSync(log, 'w');
    const child = spawn(command, [...args], { env, cwd: REPO_ROOT, stdio: ['ignore', fd, fd], detached: true });
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

/** The adapter for a platform. iOS is Builder B's adapter; until it lands the iOS door refuses. */
function adapterFor(platform: LanePlatform, env: Env): DeviceAdapter {
    if (platform === 'ios') {
        throw new Error('maestro:lanes: the iOS lanes are not wired yet');
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

    return createAndroidAdapter({
        repoRoot: REPO_ROOT,
        avd: 'ci_pixel6',
        recipeOrigin: 'http://localhost:3000',
        identityOrigin: 'http://localhost:3001',
        foodOrigin: 'http://localhost:3002',
        publishableKey: env['CLERK_PUBLISHABLE_KEY'] ?? '',
        commands,
        bootTimeoutMs: 300_000,
    });
}

/** The services a lane run owns: every queue consumer `local:up` planned, and the parse worker. */
function serviceSpecs(): readonly ServiceSpec[] {
    if (!existsSync(CONSUMER_PLAN)) {
        throw new Error('maestro:lanes: no queue-consumer plan - run `npm run local:up` first');
    }

    const consumers = (JSON.parse(readFileSync(CONSUMER_PLAN, 'utf8')) as readonly { readonly name: string }[]).map(
        ({ name }): ServiceSpec => ({
            name,
            pattern: new RegExp(`bin/queueConsumer\\.ts ${name.replace(/[^\w-]/gu, '')}( |$)`, 'u'),
            command: 'npx',
            args: ['tsx', 'packages/tools/local-sandbox/bin/queueConsumer.ts', name],
        }),
    );

    return [
        ...consumers,
        {
            name: 'parseWorker',
            pattern: /recipe-workers.*src\/local\/main\.ts|src\/local\/main\.ts/u,
            command: 'npm',
            args: ['run', 'dev', '--workspace=@kitchensink/recipe-workers'],
        },
    ];
}

/** Start one service and wait until it is ready: a consumer prints `draining`, the worker is alive after 8 s. */
async function startService(spec: ServiceSpec, env: Env): Promise<RunningService> {
    const log = path.join(STATE_DIR, `service.${spec.name}.log`);
    const { pid } = spawnDetached(spec.command, spec.args, log, env);
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
            return { flows: [], notes: [outcome.stderr.trim()] };
        }

        throw new Error(`maestro:lanes: the runner could not select flows: ${outcome.stderr.trim()}`);
    }

    return {
        flows: values('flow'),
        notes: [
            ...values('needs-sandbox').map((row) => `not run locally: needs sandbox - ${row.replace('|', ' (')})`),
            ...values('excluded').map((flow) => `excluded on ${platform}: ${flow}`),
        ],
    };
}

/** The selection: FULL_SUITE, the named flows, or the impact selector's mobile tier (whose failure runs everything). */
async function resolveSelection(
    selection: 'all' | 'changed' | readonly string[],
    env: Env,
): Promise<'all' | readonly string[]> {
    if (selection !== 'changed') {
        return selection;
    }

    try {
        const plan = await runPlan(REPO_ROOT, env);

        return plan.mobile.kind === 'all' ? 'all' : plan.mobile.ids;
    } catch (error) {
        process.stderr.write(`maestro:lanes: the impact selector failed, so every flow runs (${String(error)})\n`);

        return 'all';
    }
}

/**
 * Start the shared services for the run, then build the downgraded owner's world (`recipes/makePublicConfirm` reads
 * it); building it creates no user.
 *
 * @sideEffect Starts the queue consumers and the parse worker; writes the local recipe world.
 */
async function startServices(base: Env) {
    const services = await startSharedServices(serviceSpecs(), {
        listProcesses: async () =>
            (await run('ps', ['-eo', 'pid=,args='])).stdout
                .split('\n')
                .map((line) => /^\s*(\d+)\s+(.*)$/u.exec(line))
                .flatMap((match) => (match === null ? [] : [{ pid: Number(match[1]), command: match[2] ?? '' }]))
                .filter((entry) => entry.pid !== process.pid),
        start: (spec) => startService(spec, base),
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
                consolePort: lane.device.replace(/^emulator-/u, ''),
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
    const base = baseEnvironment();
    // `listLocalLanes` and the lane slots read the namespace from this process.
    process.env['E2E_POOL_NAMESPACE'] = 'local';
    const selection = await resolveSelection(args.selection, base);

    if (selection !== 'all' && selection.length === 0) {
        process.stdout.write('maestro:lanes: nothing to run - no change touches a screen a Maestro flow covers\n');

        return 0;
    }

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

    const log = (line: string): void => {
        process.stdout.write(`maestro:lanes: ${new Date().toISOString().slice(11, 19)} ${line}\n`);
    };

    const deps: LaneRunDeps = {
        adapterFor: (platform) => adapterFor(platform, base),
        stateDir: STATE_DIR,
        repoRoot: REPO_ROOT,
        lockDir: path.join(STATE_DIR, 'locks'),
        baseEnv: base,
        acquireLock: () => acquireHostLock(path.join(STATE_DIR, 'maestroLanes.lock'), process.pid, pidIsAlive),
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
        startServices: () => startServices(base),
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

            if (lane.platform === 'android') {
                watchUsage(lane, child, log);
            }

            return child;
        },
        aborted: () => aborted,
        staggerMs: Number(process.env['MAESTRO_LANE_STAGGER_SECONDS'] ?? 20) * 1000,
        log,
    };

    return runLaneRun(deps, { platforms: args.platforms, requested: args.requested, selection });
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
