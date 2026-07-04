/**
 * U2 (FR-5/KTD-5) — out-of-band server-side metric collector.
 *
 * Over the run window, samples the food service's own operational truth (the admin `/metrics` + `/queue`
 * endpoints, using the observer token from grant-admin.mjs) and best-effort CloudWatch data points
 * (Commise/Food EMF metrics + ECS CPU), writing a timestamped series. The report step (U5) correlates
 * this with k6's client-side metrics by wall-clock window — the observer is decoupled from k6 on purpose.
 *
 * The admin token is ~60s-lived, so it is refreshed on the same handle throughout the (minutes-long)
 * window; a sample whose admin poll fails is recorded with its status/error rather than silently dropped,
 * and the series file is written atomically each tick so an interrupt can never corrupt earlier samples.
 *
 * Env: ADMIN_FILE (admin.json from grant-admin), FOOD_BASE_URL, DURATION_S, INTERVAL_S, OUT_FILE,
 *      FAPI, ORIGIN; optional CloudWatch: AWS creds + REGION, CW_NAMESPACE, FOOD_CLUSTER, FOOD_SERVICE.
 * @sideEffect Reads admin.json; polls HTTP + (optionally) shells `aws cloudwatch`; writes OUT_FILE.
 */
import { execFile } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import { mintSessionToken } from '../auth/provision-users.mjs';

const execFileAsync = promisify(execFile);

const ADMIN_FILE = process.env['ADMIN_FILE'] ?? './admin.json';
const FOOD_BASE_URL = (process.env['FOOD_BASE_URL'] ?? 'https://food-pr-59.commise.app').replace(/\/$/, '');
const DURATION_S = Number(process.env['DURATION_S'] ?? 60);
const INTERVAL_S = Number(process.env['INTERVAL_S'] ?? 10);
const OUT_FILE = process.env['OUT_FILE'] ?? './server-metrics.json';
const REFRESH_AFTER_S = Number(process.env['REFRESH_AFTER_S'] ?? 30);

const REGION = process.env['REGION'] ?? process.env['AWS_REGION'] ?? 'us-east-1';
const CW_NAMESPACE = process.env['CW_NAMESPACE'] ?? 'Commise/Food';
const FOOD_CLUSTER = process.env['FOOD_CLUSTER']; // ECS cluster name (optional CPU pull)
const FOOD_SERVICE = process.env['FOOD_SERVICE'];

let admin = null; // loaded in main() so a missing/corrupt handle fails with a clear diagnostic
let adminToken = null;
let mintedAt = 0;

async function freshAdminToken() {
    if (adminToken && Date.now() - mintedAt < REFRESH_AFTER_S * 1000) {
        return adminToken;
    }

    adminToken = await mintSessionToken(admin.sessionId, admin.devJwt, admin.cookie);
    mintedAt = Date.now();

    return adminToken;
}

async function getJson(path, token) {
    const res = await fetch(`${FOOD_BASE_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    // Parse defensively: a 2xx with an empty / non-JSON body must not reject and discard the tick.
    const body = res.ok ? await res.json().catch(() => null) : null;

    return { status: res.status, body };
}

/** Latest CloudWatch datapoint for a metric in a namespace (best-effort; null on any failure). */
async function cwLatest(namespace, metricName, dimensions, stat = 'Average') {
    const now = Date.now();
    const args = [
        'cloudwatch',
        'get-metric-statistics',
        '--region',
        REGION,
        '--namespace',
        namespace,
        '--metric-name',
        metricName,
        '--start-time',
        new Date(now - 5 * 60_000).toISOString(),
        '--end-time',
        new Date(now).toISOString(),
        '--period',
        '60',
        '--statistics',
        stat,
        '--output',
        'json',
    ];

    for (const [name, value] of dimensions) {
        args.push('--dimensions', `Name=${name},Value=${value}`);
    }

    try {
        const { stdout } = await execFileAsync('aws', args, { timeout: 10_000 });
        const points = JSON.parse(stdout).Datapoints ?? [];
        const latest = points.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))[0];

        return latest ? (latest[stat] ?? null) : null;
    } catch {
        return null;
    }
}

/** Best-effort CloudWatch snapshot: the service's EMF gauges + (if identifiers given) ECS CPU, in parallel
 *  so the whole snapshot costs ~one timeout, not the sum, and can't overrun the sample interval. */
async function cloudwatchSnapshot() {
    const jobs = [
        ['food-fetch-queue-depth', () => cwLatest(CW_NAMESPACE, 'food-fetch-queue-depth', [], 'Maximum')],
        [
            'food-fetch-pending-age-seconds',
            () => cwLatest(CW_NAMESPACE, 'food-fetch-pending-age-seconds', [], 'Maximum'),
        ],
        ['food-in-flight-leases', () => cwLatest(CW_NAMESPACE, 'food-in-flight-leases', [], 'Maximum')],
    ];

    if (FOOD_CLUSTER && FOOD_SERVICE) {
        jobs.push([
            'ecs-cpu-percent',
            () =>
                cwLatest('AWS/ECS', 'CPUUtilization', [
                    ['ClusterName', FOOD_CLUSTER],
                    ['ServiceName', FOOD_SERVICE],
                ]),
        ]);
    }

    const values = await Promise.all(jobs.map(([, run]) => run()));

    return Object.fromEntries(jobs.map(([key], i) => [key, values[i]]));
}

/** Atomic write: never leave OUT_FILE half-written (temp + rename is atomic on one filesystem). */
function writeSeries(series) {
    const tmp = `${OUT_FILE}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(series, null, 2)}\n`);
    renameSync(tmp, OUT_FILE);
}

async function main() {
    if (!Number.isFinite(DURATION_S) || DURATION_S <= 0 || !Number.isFinite(INTERVAL_S) || INTERVAL_S <= 0) {
        throw new Error(
            `DURATION_S and INTERVAL_S must be finite positive numbers (got ${DURATION_S}, ${INTERVAL_S}).`,
        );
    }

    try {
        admin = JSON.parse(readFileSync(ADMIN_FILE, 'utf8'));
    } catch (err) {
        throw new Error(
            `Cannot read observer handle ${ADMIN_FILE} (run auth/grant-admin.mjs first): ${err?.message ?? err}`,
        );
    }

    // Deliberately do NOT seed adminToken from admin.jwt: it may already be near-expiry by the time the
    // window starts, so the first freshAdminToken() (mintedAt=0) mints a guaranteed-fresh one.

    console.log(`Collecting server-side metrics for ${DURATION_S}s every ${INTERVAL_S}s → ${OUT_FILE}`);
    const series = [];
    writeSeries(series); // ensure a valid (empty) file exists even if the first tick is slow / killed
    const endAt = Date.now() + DURATION_S * 1000;

    while (Date.now() < endAt) {
        const ts = new Date().toISOString();

        // One tick's failure (token refresh throwing, a network blip) must not abort the window.
        try {
            const token = await freshAdminToken();
            const [queue, metrics, cloudwatch] = await Promise.all([
                getJson('/v1/foods/admin/queue', token),
                getJson('/v1/foods/admin/metrics', token),
                cloudwatchSnapshot(),
            ]);

            series.push({
                ts,
                queue: queue.status === 200 ? queue.body : { error: queue.status },
                metrics: metrics.status === 200 ? metrics.body : { error: metrics.status },
                cloudwatch,
            });
        } catch (err) {
            series.push({ ts, error: err?.message ?? String(err) });
        }

        writeSeries(series);
        await delay(INTERVAL_S * 1000);
    }

    console.log(`Wrote ${series.length} samples to ${OUT_FILE}.`);
}

await main();
