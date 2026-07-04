/**
 * U5 (SC-ramp/FR-6/KTD-5) — one-command orchestrator for the food-API load test.
 *
 *   provision distinct-user pool  ->  grant a food:admin observer  ->  (k6 journey  ||  server-side
 *   metric collector)  ->  correlated capacity + degradation report  ->  teardown (delete all test users).
 *
 * Teardown runs in a `finally` so a failed/interrupted run never leaks Clerk users. k6's per-metric
 * summary (thresholds incl.) is correlated with the collector's timestamped server series into report.md.
 *
 * Env: CLERK_SECRET_KEY (required), everything in config.example.env, plus:
 *   OUT_DIR (default .), COLLECT_INTERVAL_S (default 10), KEEP (skip teardown), SKIP_K6 (dry orchestrate),
 *   FOOD_CLUSTER/FOOD_SERVICE (optional CloudWatch dims).
 * @sideEffect Creates+deletes Clerk users; runs k6 + aws; writes pool.json/admin.json/summary/report.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// Absolute so the children (which run with cwd=HERE) and this process agree on where the files are,
// regardless of the directory run.mjs was invoked from.
const OUT_DIR = resolve(process.env['OUT_DIR'] ?? '.');
const SK = process.env['CLERK_SECRET_KEY'] ?? process.env['CLERK_SK'];
const BAPI = 'https://api.clerk.com/v1';
const POOL_SIZE = Number(process.env['POOL_SIZE'] ?? process.env['MAX_VUS'] ?? 100);
const COLLECT_INTERVAL_S = Number(process.env['COLLECT_INTERVAL_S'] ?? 10);
const KEEP = process.env['KEEP'] === '1' || process.env['KEEP'] === 'true';
const SKIP_K6 = process.env['SKIP_K6'] === '1';

const SUMMARY_FILE = join(OUT_DIR, 'k6-summary.json');
const SERVER_FILE = join(OUT_DIR, 'server-metrics.json');
const REPORT_FILE = join(OUT_DIR, 'report.md');

if (!SK) {
    throw new Error('CLERK_SECRET_KEY (or CLERK_SK) is required.');
}

/** Run a subprocess to completion, inheriting stdio; reject on non-zero exit. */
function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: 'inherit', cwd: HERE, ...opts });
        child.on('error', reject);
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args[0]} exited ${code}`))));
    });
}

/** Parse a k6 duration string ("30s", "1m", "1m30s") to seconds; throws on an unrecognized format. */
function durationSeconds(text) {
    const s = String(text).trim();
    let total = 0;
    let matched = false;

    for (const [, n, unit] of s.matchAll(/(\d+)(ms|s|m|h)/g)) {
        total += Number(n) * { ms: 0.001, s: 1, m: 60, h: 3600 }[unit];
        matched = true;
    }

    // Digits present but no valid <n><unit> token (e.g. "120", "abc") — fail loud, don't silently return 0.
    if (!matched && /\d/.test(s)) {
        throw new Error(`Unrecognized duration "${text}" — use units like 30s, 1m, 1m30s.`);
    }

    return total;
}

/** Total wall-clock the k6 scenario stages span (+ a small drain buffer), to size the collector window.
 *  COLLECT_DURATION_S overrides it explicitly (handy for smoke runs). */
function runWindowSeconds() {
    if (process.env['COLLECT_DURATION_S']) {
        return Number(process.env['COLLECT_DURATION_S']);
    }

    const stages = [
        process.env['BASELINE_DURATION'] ?? '30s',
        '15s',
        process.env['HOLD_DURATION'] ?? '1m',
        process.env['RAMP_DURATION'] ?? '1m',
        '15s',
    ];

    return Math.ceil(stages.reduce((sum, s) => sum + durationSeconds(s), 0)) + 20;
}

async function deleteUsers(userIds) {
    let ok = 0;
    for (const userId of userIds) {
        let deleted = false;

        for (let attempt = 0; attempt < 4 && !deleted; attempt += 1) {
            const res = await fetch(`${BAPI}/users/${userId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${SK}` },
            }).catch(() => ({ status: 0 }));

            if (res.status === 200 || res.status === 404) {
                deleted = true;
            } else {
                // 429 / transient — back off and retry so a large pool teardown doesn't leak users.
                await delay(500 * 2 ** attempt);
            }
        }

        if (deleted) {
            ok += 1;
        } else {
            console.error(`  !! ORPHANED USER ${userId} — teardown DELETE kept failing; delete manually.`);
        }
    }

    return ok;
}

function readJson(path) {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

/** Correlate k6 summary + server series into a markdown capacity/degradation report. */
function buildReport() {
    const summary = readJson(SUMMARY_FILE);
    const server = readJson(SERVER_FILE) ?? [];
    const m = summary?.metrics ?? {};
    const val = (name, key) => m[name]?.values?.[key];
    // Shape-agnostic threshold read: k6's summary-export represents a threshold entry as either a bare
    // boolean or `{ ok }`. Returns true ONLY if the metric has thresholds and ALL passed; null if the
    // metric/thresholds are absent (which the verdict treats as NOT a pass, never as success).
    const thr = (name) => {
        const t = m[name]?.thresholds;

        if (!t) {
            return null;
        }

        return Object.values(t).every((x) => x === true || x?.ok === true);
    };

    // Each sample's `queue` is the /v1/foods/admin/queue body: { pending, inFlight, tombstone }.
    const queueDepths = server.map((s) => s?.queue?.pending).filter((n) => typeof n === 'number');
    const maxQueue = queueDepths.length ? Math.max(...queueDepths) : null;

    const lines = [
        `# Food API load-test report`,
        ``,
        `Target: \`${process.env['FOOD_BASE_URL'] ?? 'https://food-pr-59.commise.app'}\`  ·  pool: ${POOL_SIZE} users  ·  ` +
            `profile: baseline ${process.env['BASELINE_RATE'] ?? 1}/s → hold ${process.env['HOLD_RATE'] ?? 2}/s → ` +
            `ramp ${process.env['RAMP_RATE'] ?? 3}/s`,
        ``,
        `## Client-side (k6)`,
        `| signal | value | threshold |`,
        `| --- | --- | --- |`,
        `| total requests | ${val('http_reqs', 'count') ?? 'n/a'} | |`,
        `| iterations | ${val('iterations', 'count') ?? 'n/a'} | |`,
        `| search p95 (ms) | ${fmt(val('food_search_latency', 'p(95)'))} | ${verdict(thr('food_search_latency'))} |`,
        `| add-accept p95 (ms) | ${fmt(val('food_add_accept_latency', 'p(95)'))} | ${verdict(thr('food_add_accept_latency'))} |`,
        `| unexpected 5xx rate | ${fmt(val('food_unexpected_5xx', 'rate'))} | ${verdict(thr('food_unexpected_5xx'))} |`,
        `| auth-fail rate | ${fmt(val('food_auth_fail', 'rate'))} | ${verdict(thr('food_auth_fail'))} |`,
        `| shed 503s (backpressure) | ${val('food_auth_shed_503', 'count') ?? 0} | |`,
        `| reached-terminal rate | ${fmt(val('food_reached_terminal', 'rate'))} | |`,
        `| dropped iterations | ${val('dropped_iterations', 'count') ?? 0} | ${verdict(thr('dropped_iterations'))} |`,
        ``,
        `## Server-side (admin + CloudWatch, ${server.length} samples)`,
        `- peak fetch_queue pending depth: ${maxQueue ?? 'n/a'}`,
        `- see \`${SERVER_FILE}\` for the full timestamped series.`,
        ``,
        `## Verdict`,
        verdictParagraph(m, val, thr),
        ``,
    ];

    writeFileSync(REPORT_FILE, `${lines.join('\n')}\n`);
    console.log(`\nReport → ${REPORT_FILE}`);
}

function fmt(n) {
    return typeof n === 'number' ? Math.round(n * 1000) / 1000 : 'n/a';
}

function verdict(ok) {
    return ok === true ? '✅ pass' : ok === false ? '❌ FAIL' : '—';
}

function verdictParagraph(m, val, thr) {
    if (SKIP_K6) {
        return '_k6 was skipped (SKIP_K6) — orchestration/teardown dry run only._';
    }

    if (!m || Object.keys(m).length === 0 || (val('http_reqs', 'count') ?? 0) === 0) {
        return '⚠️ **No client-side data** — k6 produced no requests (did it run? is the summary present?). Nothing to conclude.';
    }

    // Absence is NOT success: require the metric/threshold to be PRESENT and passing.
    const authRate = val('food_auth_fail', 'rate');
    const authClean = typeof authRate === 'number' && authRate < 0.005;

    if (!authClean) {
        return authRate === undefined
            ? '⚠️ **Run is SUSPECT** — the auth-fail metric is absent, so token health is unknown; do not trust the capacity numbers. Re-run.'
            : '⚠️ **Run is SUSPECT** — non-trivial auth-fail rate means tokens expired; any shed-503s are a harness artifact, not real backpressure. Re-run.';
    }

    if (thr('dropped_iterations') !== true) {
        return '⚠️ **Load under-delivered / inconclusive** — dropped_iterations tripped or was not recorded; the arrival rate was likely not applied (raise MAX_VUS). Capacity numbers are not meaningful.';
    }

    const held =
        thr('food_search_latency') === true &&
        thr('food_add_accept_latency') === true &&
        thr('food_unexpected_5xx') === true;

    return held
        ? `✅ **SC-hold held** at the hold rate — sustained supported throughput ≈ **${process.env['HOLD_RATE'] ?? 2} req/s** of the full journey. Degradation at ramp is shown by the shed-503 count + reached-terminal rate above (graceful backpressure, auth-clean).`
        : `❌ **SC-hold breached / inconclusive** — a latency or 5xx threshold failed or was not recorded at the target rate; the supported rate is below the configured hold rate. Lower HOLD_RATE and re-run.`;
}

async function main() {
    const poolPath = join(OUT_DIR, 'pool.json');
    const adminPath = join(OUT_DIR, 'admin.json');
    let collector = null;
    let collectorExited = false;
    let collectorDone; // assigned to the collector's exit/error promise the moment it is spawned

    // A run must only ever report on its OWN artifacts — never a prior run's stale summary/series.
    for (const f of [SUMMARY_FILE, SERVER_FILE, REPORT_FILE]) {
        rmSync(f, { force: true });
    }

    try {
        console.log(`\n[1/4] Provisioning ${POOL_SIZE}-user pool + admin observer…`);
        await run('node', ['auth/provision-users.mjs'], {
            env: { ...process.env, POOL_SIZE: String(POOL_SIZE), OUT_DIR },
        });
        await run('node', ['auth/grant-admin.mjs'], { env: { ...process.env, OUT_DIR } });

        const windowS = runWindowSeconds();

        if (!Number.isFinite(windowS) || windowS <= 0) {
            throw new Error(
                `Collector window computed as ${windowS}s — check the *_DURATION / COLLECT_DURATION_S envs.`,
            );
        }

        console.log(`\n[2/4] Starting server-side collector for ~${windowS}s…`);
        collector = spawn('node', ['observe/collect-metrics.mjs'], {
            stdio: 'inherit',
            cwd: HERE,
            env: {
                ...process.env,
                ADMIN_FILE: adminPath,
                OUT_FILE: SERVER_FILE,
                DURATION_S: String(windowS),
                INTERVAL_S: String(COLLECT_INTERVAL_S),
            },
        });
        // Attach lifecycle NOW, before the (blocking) k6 run — if the collector exits early or fails to
        // spawn, we must still observe it, or the post-k6 await would hang forever and skip teardown.
        collectorDone = new Promise((res) => {
            collector.once('exit', () => {
                collectorExited = true;
                res();
            });
            collector.once('error', (e) => {
                collectorExited = true;
                console.error(`  collector spawn error: ${e.message}`);
                res();
            });
        });

        console.log(`\n[3/4] Running k6 journey…`);
        if (SKIP_K6) {
            console.log('  SKIP_K6 set — skipping the k6 run (orchestration dry run).');
        } else {
            // Prepend this package's node_modules/.bin so the k6 from `npm run k6:install` is found whether
            // run.mjs is invoked via `npm run loadtest` or bare `node run.mjs`.
            const code = await new Promise((res, rej) => {
                const k6 = spawn('k6', ['run', `--summary-export=${SUMMARY_FILE}`, 'journey.js'], {
                    stdio: 'inherit',
                    cwd: HERE,
                    env: {
                        ...process.env,
                        POOL_FILE: poolPath,
                        PATH: `${join(HERE, 'node_modules', '.bin')}:${process.env['PATH'] ?? ''}`,
                    },
                });
                k6.on('error', rej);
                k6.on('exit', res);
            }).catch((err) => {
                throw new Error(`could not start k6 (${err.message}). Run \`npm run k6:install\` first.`);
            });

            // Exit 99 = k6 thresholds were breached — that's a RESULT (the report shows which), not a
            // harness failure, so proceed to build the report. Any other non-zero is a real k6 error.
            if (code === 99) {
                console.warn('  ⚠️ k6 thresholds breached — see the report for which (this is a result, not an error).');
            } else if (code !== 0) {
                throw new Error(`k6 exited ${code} — script/config error (see the k6 output above).`);
            }
        }

        await collectorDone; // resolves immediately if the collector already exited during the k6 run

        console.log(`\n[4/4] Building report…`);
        buildReport();
    } finally {
        // Never leave the collector running if the run bailed out (e.g. k6 failed) before it self-exited.
        if (collector && !collectorExited) {
            collector.kill('SIGTERM');
        }

        if (!KEEP) {
            const pool = readJson(poolPath) ?? [];
            const admin = readJson(adminPath);
            const ids = [...pool.map((p) => p.userId), ...(admin ? [admin.userId] : [])].filter(Boolean);
            console.log(`\nTeardown: deleting ${ids.length} test users…`);
            const ok = await deleteUsers(ids);
            console.log(`  deleted ${ok}/${ids.length}. (added foods live in the per-PR DB, dropped on PR close.)`);
        } else {
            console.log('\nKEEP set — leaving test users + pool.json/admin.json in place.');
        }
    }
}

await main();
