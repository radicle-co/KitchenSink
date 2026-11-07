/**
 * `npm run maestro:macUsage --workspace=@kitchensink/local-sandbox` — watches the Mac while iOS lanes run and, on
 * SIGINT or SIGTERM, prints each lane's mean CPUs and peak memory. Start it next to `test:e2e:ios` (it needs the lane
 * Simulators to exist, so start it once the first lane has booted). The numbers feed `IOS_LANE_COST` in
 * `src/maestroLanes/iosAdapter.ts`.
 *
 * It reads and prints only. Every `ps` sample is also appended to `<state>/macLaneUsage.tsv`.
 *
 * @sideEffect Runs ssh on a timer and writes the tsv.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { emptyUsage, recordSample, summarizeUsage, type Usage } from '../src/maestroLanes/laneUsage.js';
import { iosLaneProcesses, parseMacPs } from '../src/maestroLanes/macUsage.js';
import { IOS_MAX_LANES, macHostFromEnv } from '../src/maestroLanes/iosLane.js';

const INTERVAL_MS = 15_000;
const host = macHostFromEnv(process.env);
const stateDir = path.join(
    process.env['XDG_STATE_HOME'] ?? path.join(process.env['HOME'] ?? '', '.local/state'),
    'kitchensink',
);
const tsv = path.join(stateDir, 'macLaneUsage.tsv');
const ssh = (command: string): string =>
    execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', host, command], { encoding: 'utf8' });

mkdirSync(stateDir, { recursive: true });

const macHome = ssh('printenv HOME').trim();
const usages = new Map<number, Usage>();
const udids = new Map<number, string>();

function sample(): void {
    const at = Date.now();
    const rows = parseMacPs(ssh('ps -axo pid=,pgid=,time=,rss=,args='));
    let machine = 0;

    for (let lane = 1; lane <= IOS_MAX_LANES; lane += 1) {
        const udid = udids.get(lane) ?? ssh(`bash ksIos/lane/laneHost.sh udid ${String(lane)}`).trim();

        if (udid === '') {
            continue;
        }

        udids.set(lane, udid);
        const mine = iosLaneProcesses(rows, { udid, laneHome: `${macHome}/ksIos/lanes/lane${String(lane)}` });
        const usage = recordSample(usages.get(lane) ?? emptyUsage(), mine, at);
        usages.set(lane, usage);
        machine += mine.reduce((sum, row) => sum + row.rssKb, 0);
        appendFileSync(tsv, `${at}\t${String(lane)}\t${usage.cpuSeconds}\t${mine.reduce((s, r) => s + r.rssKb, 0)}\n`);
    }

    process.stdout.write(
        `macUsage ${new Date(at).toISOString()} lanes ${String(udids.size)} rss ${(machine / 1024 ** 2).toFixed(1)} GiB\n`,
    );
}

function report(): void {
    for (const [lane, usage] of usages) {
        const { seconds, meanCpus, peakRssBytes } = summarizeUsage(usage);
        process.stdout.write(
            `lane ios-${String(lane)} usage: ${String(meanCpus)} CPUs mean, ${(peakRssBytes / 1024 ** 3).toFixed(2)} GiB peak, over ${String(Math.round(seconds))} s\n`,
        );
    }
}

const timer = setInterval(sample, INTERVAL_MS);
sample();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
        clearInterval(timer);
        report();
        process.exit(0);
    });
}
