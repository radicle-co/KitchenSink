/**
 * The lanes of a local Playwright run: what one costs, the environment and arguments each is given, the ports, and
 * starting them and merging their reports.
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

import type { LaneCost } from '@kitchensink/e2e-plan';
import { processEnv, type Env } from '@kitchensink/e2e-plan/stampRun';

import { BLOB_DIR, LANE_LOG_DIR } from './e2ePaths';
import { run, sleep, waitForExit } from './e2eProcess';
import { parseReport, type PlaywrightReport } from './e2eReport';
import { deadOrigins } from './e2eServer';

const GIB = 1024 ** 3;

/**
 * What one lane costs, from the full-suite run of 2026-11-08 (8 lanes on one shared server, 20 CPUs, sampled every 2 s
 * over each lane's process tree: Playwright and its browsers). A lane's CPU averaged 0.34 cores (p95 0.67, p99 0.87)
 * and its resident memory 1.17 GiB (p95 1.30, peak 1.88; summed RSS counts shared pages twice). The figures are rounded
 * up from the p95 so the planner does not oversubscribe. The earlier 1.5 CPUs and 2 GiB paid for a Next server per lane.
 */
export const LANE_COST: LaneCost = { cpus: 0.75, memBytes: 1.5 * GIB };

/** What the one shared `next start` costs, whatever the lane count: CPU mean 0.54 (peak 0.90), memory mean 0.57 GiB (peak 0.62). */
export const SERVER_COST: LaneCost = { cpus: 1, memBytes: 0.75 * GIB };

/**
 * The most lanes tried against Clerk's dev instance at once (8, the size of the `web` pool slots). It served all 8 with
 * no more `FAPI request failed` lines than one lane produces, so the pool size, not Clerk, is the limit; raise this only
 * with a bigger pool and a new measurement.
 */
export const WEB_LANE_CLERK_CEILING = 8;

const PORT_RANGE = { first: 3010, last: 3060 } as const;

export interface Lane {
    readonly index: number;
    readonly count: number;
}

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
export function laneEnv(base: Env, lane: Lane & { readonly port: number; readonly sharedServer?: boolean }): Env {
    return {
        ...base,
        ...deadOrigins(),
        E2E_SKIP_BUILD: '1',
        E2E_PORT: String(lane.port),
        ...(lane.sharedServer === true ? { E2E_SHARED_SERVER: '1' } : {}),
        COMMISE_E2E_SHARD: String(lane.index),
        E2E_REPORTER: 'list,blob',
        PLAYWRIGHT_BLOB_OUTPUT_DIR: `${BLOB_DIR}/lane-${lane.index}`,
        PLAYWRIGHT_BLOB_OUTPUT_NAME: `report-${lane.index}.zip`,
    };
}

/**
 * The Playwright arguments of one lane: its own test list and output folder. No `--shard`: the list is what splits
 * the work, weighted by duration (`laneLists`).
 *
 * @param lane - Which lane, of how many.
 * @param listFile - The lane's `--test-list` file.
 * @returns The arguments.
 */
export const laneArgs = (lane: Lane, listFile: string): readonly string[] => [
    '--test-list',
    listFile,
    `--output=test-results/lane-${lane.index}`,
];

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

export const listeningPorts = (): ReadonlySet<number> => {
    const output = spawnSync('ss', ['-ltn'], { encoding: 'utf8' }).stdout;

    return new Set([...output.matchAll(/:(\d+)\s/gu)].map((match) => Number(match[1])));
};

export interface LaneStart {
    readonly env: Env;
    /** One `--test-list` text per lane. */
    readonly texts: readonly string[];
    /** Each lane's port; one port, shared, when {@link shared}. */
    readonly ports: readonly number[];
    readonly shared: boolean;
    readonly staggerSeconds: number;
}

/**
 * Starts every lane, staggered, one log each, and waits for them all.
 *
 * @sideEffect Spawns `scripts/e2eLocal.sh` once per lane and writes each lane's list and log under {@link LANE_LOG_DIR}.
 * @param input - The lane lists, ports, whether they share one server, and the gap between starts.
 * @returns Each lane's exit code, null for a lane a signal killed.
 */
export async function startLanes(input: LaneStart): Promise<readonly (number | null)[]> {
    const exits: Promise<number | null>[] = [];

    for (const [offset, text] of input.texts.entries()) {
        const port = input.ports[input.shared ? 0 : offset] ?? 0;
        const lane = { index: offset + 1, count: input.texts.length };
        const listFile = `${LANE_LOG_DIR}/lane-${lane.index}.list`;

        writeFileSync(listFile, text);

        const log = openSync(`${LANE_LOG_DIR}/lane-${lane.index}.log`, 'w');
        const child = spawn('bash', ['scripts/e2eLocal.sh', ...laneArgs(lane, listFile)], {
            env: processEnv(laneEnv(input.env, { ...lane, port, sharedServer: input.shared })),
            stdio: ['ignore', log, log],
        });

        console.log(
            `▶ lane ${lane.index}/${lane.count}     : port ${port}, log ${LANE_LOG_DIR}/lane-${lane.index}.log`,
        );
        exits.push(waitForExit(child));
        await sleep(input.staggerSeconds);
    }

    return await Promise.all(exits);
}

/** The merged report of all lanes. */
export const MERGED_FILE = `${LANE_LOG_DIR}/merged.json`;

/**
 * Merges the lanes' blob reports into one JSON report.
 *
 * @sideEffect Copies the blobs, runs `playwright merge-reports`, and reads the merged file.
 * @param env - The caller's environment.
 * @returns The merged report, or an empty one when the merge failed (the count check then fails the run).
 */
export function mergeLaneReports(env: Env): PlaywrightReport {
    const mergedDir = `${BLOB_DIR}/merged`;

    mkdirSync(mergedDir, { recursive: true });

    for (const lane of readdirSync(BLOB_DIR).filter((entry) => entry.startsWith('lane-'))) {
        for (const zip of readdirSync(`${BLOB_DIR}/${lane}`).filter((entry) => entry.endsWith('.zip'))) {
            cpSync(`${BLOB_DIR}/${lane}/${zip}`, `${mergedDir}/${zip}`);
        }
    }

    const merged = run('npx', ['playwright', 'merge-reports', '--reporter=json', mergedDir], {
        ...env,
        PLAYWRIGHT_JSON_OUTPUT_FILE: MERGED_FILE,
    });

    return merged === 0 ? parseReport(readFileSync(MERGED_FILE, 'utf8')) : { suites: [] };
}
