/**
 * U6 orchestrator — prove the USDA rate-limit stall→resume UNDER LOAD. Requires a persistent pool
 * (`npm run provision:pool`) and a preview deployed with a LOW cap + SHORT window (CDK context
 * `foodSourceRateLimitPerHour` / `foodSourceWindowSeconds`).
 *
 *   start server-side collector  ->  fire the k6 burst (ratelimit.js floods unique cache-missing adds)
 *   ->  keep sampling admin /metrics (sources[usda].paused/utilization) + /queue depth across the window
 *   ->  verdict: STALL seen (worker paused at the cap, queue backed up) THEN RESUME (paused clears, drains).
 *
 * Env: CLERK_SECRET_KEY, FOOD_BASE_URL, WINDOW_SECONDS (the preview's FOOD_SOURCE_WINDOW_SECONDS, to size
 *   the observation), BURST_COUNT/BURST_RATE, RATELIMIT_DURATION_S (override), OUT_DIR, COLLECT_INTERVAL_S.
 * @sideEffect Adds foods (persist in the per-PR DB); runs k6 + polls admin; writes server-metrics.json.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(process.env['OUT_DIR'] ?? '.');
const SERVER_FILE = join(OUT_DIR, 'server-metrics.json');
const WINDOW_SECONDS = Number(process.env['WINDOW_SECONDS'] ?? 60);
const COLLECT_INTERVAL_S = Number(process.env['COLLECT_INTERVAL_S'] ?? 5);
// Observe long enough to see the burst land, the window fill (stall), the window clear, and the drain.
const DURATION_S = Number(process.env['RATELIMIT_DURATION_S'] ?? WINDOW_SECONDS * 2 + 60);

if (!process.env['CLERK_SECRET_KEY'] && !process.env['CLERK_SK']) {
    throw new Error('CLERK_SECRET_KEY is required (backend token refresh).');
}

for (const f of [join(OUT_DIR, 'pool.json'), join(OUT_DIR, 'admin.json')]) {
    if (!existsSync(f)) {
        throw new Error(`${f} missing — run \`npm run provision:pool\` first.`);
    }
}

/** Run a subprocess to completion; resolve with the exit code (never rejects on non-zero). */
function run(cmd, args, opts = {}) {
    return new Promise((res, rej) => {
        const child = spawn(cmd, args, { stdio: 'inherit', cwd: HERE, ...opts });
        child.on('error', rej);
        child.on('exit', (code) => res(code ?? 1));
    });
}

console.log(`[1/3] Collector: sampling admin /metrics + /queue for ~${DURATION_S}s (every ${COLLECT_INTERVAL_S}s)…`);
const collector = spawn('node', ['observe/collect-metrics.mjs'], {
    stdio: 'inherit',
    cwd: HERE,
    env: {
        ...process.env,
        ADMIN_FILE: join(OUT_DIR, 'admin.json'),
        OUT_FILE: SERVER_FILE,
        DURATION_S: String(DURATION_S),
        INTERVAL_S: String(COLLECT_INTERVAL_S),
    },
});
const collectorDone = new Promise((res) => collector.once('exit', res));

// Let a couple of baseline samples land before the burst so "before" is visible in the series.
await new Promise((res) => setTimeout(res, COLLECT_INTERVAL_S * 1000 + 500));

console.log('[2/3] Burst: flooding unique cache-missing adds via k6 (drives the USDA window to its cap)…');
await run('k6', ['run', 'ratelimit.js'], {
    env: {
        ...process.env,
        POOL_FILE: join(OUT_DIR, 'pool.json'),
        RUN_TAG: `rl${WINDOW_SECONDS}`,
        PATH: `${join(HERE, 'node_modules', '.bin')}:${process.env['PATH'] ?? ''}`,
    },
});

console.log('[3/3] Observing stall→resume for the rest of the window…');
await collectorDone;

// ── Verdict from the admin-metrics series ────────────────────────────────────────────────────────────
const series = existsSync(SERVER_FILE) ? JSON.parse(readFileSync(SERVER_FILE, 'utf8')) : [];
const usda = (sample) => (sample?.metrics?.sources ?? []).find((s) => s.source === 'usda');
const rows = series.map((s) => ({
    t: s.ts, // collect-metrics.mjs writes the sample timestamp as `ts`
    paused: usda(s)?.paused ?? null,
    util: usda(s)?.utilization ?? null,
    windowCount: usda(s)?.windowCount ?? null,
    hardCap: usda(s)?.hardCap ?? null,
    pending: s?.queue?.pending ?? null,
}));

const pausedRows = rows.filter((r) => r.paused === true);
const sawStall = pausedRows.length > 0;
// Resume = the LAST paused sample is followed by an un-paused one whose queue has drained back down.
const lastPausedIdx = rows.map((r) => r.paused === true).lastIndexOf(true);
const afterPause = lastPausedIdx >= 0 ? rows.slice(lastPausedIdx + 1) : [];
const sawResume = afterPause.some((r) => r.paused === false);
const peakPending = Math.max(0, ...rows.map((r) => r.pending ?? 0));

console.log('\n── USDA window over time (util | paused | windowCount/hardCap | queue.pending) ──');
for (const r of rows) {
    console.log(
        `  util=${r.util == null ? 'n/a' : (r.util * 100).toFixed(0) + '%'}  paused=${r.paused}  ` +
            `count=${r.windowCount ?? '?'}/${r.hardCap ?? '?'}  pending=${r.pending ?? '?'}`,
    );
}

console.log('\n── Verdict ──');
console.log(`  peak queue pending: ${peakPending}`);
console.log(`  STALL observed (worker paused at cap):   ${sawStall ? '✅ yes' : '❌ NO'}`);
console.log(`  RESUME observed (paused cleared after):  ${sawResume ? '✅ yes' : '❌ NO'}`);

if (sawStall && sawResume) {
    console.log('\n✅ Rate-limit stall→resume held under load.');
} else if (!sawStall) {
    console.log(
        '\n⚠️ No stall seen — is the preview deployed with a LOW cap (foodSourceRateLimitPerHour)? Was the burst big enough (BURST_COUNT > cap)?',
    );
    process.exitCode = 1;
} else {
    console.log(
        '\n⚠️ Stalled but no resume within the window — is FOOD_SOURCE_WINDOW_SECONDS short enough for the observation, and RATELIMIT_DURATION_S long enough to see it clear?',
    );
    process.exitCode = 1;
}
