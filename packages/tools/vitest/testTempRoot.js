import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Vitest `globalSetup` that confines every test-created temp directory to ONE removable root.
 *
 * ## ⛔ WHY THIS EXISTS — 95,827 leaked directories, 110 GB, a disk at 100%
 *
 * Two independent producers, both writing into the OS temp directory and neither cleaning up:
 *
 *  1. **`aws-cdk-lib` itself.** `new App()` with no `outdir` synthesises into `mkdtemp(cdk.out*)` under
 *     `os.tmpdir()`. Thirty-four test files construct an App that way, one directory leaked per synth, at
 *     ~1.7 MB each. Measured 2026-08-27: **64,544** such directories, 4,042 of them from a single day's
 *     test runs.
 *  2. **Our own fixtures.** `mkdtempSync(path.join(tmpdir(), …))` appears across the suites and the teardown
 *     is inconsistent — several files have no `afterEach` or `rmSync` at all. Measured: another **31,283**
 *     directories across ten prefixes.
 *
 * ## ⛔ WHY `TMPDIR` AND NOT `CDK_OUTDIR`
 *
 * `CDK_OUTDIR` looks like the targeted fix and is the wrong one: `App`'s constructor reads
 * `props.autoSynth ?? (OUTDIR_ENV in process.env)`, so merely SETTING it registers a `beforeExit` synth on
 * every App in the process. That is a behaviour change to every infra suite, bought to solve a disk problem.
 *
 * `TMPDIR` is what `os.tmpdir()` reads on POSIX, so redirecting it catches **both** producers — CDK's
 * internal `mkdtemp` and every `mkdtempSync(tmpdir())` in our own fixtures — and changes no test behaviour:
 * the directories are created and used exactly as before, they simply land somewhere finite.
 *
 * ⚠️ The root is deliberately INSIDE the repo (and gitignored), not a second location under `/tmp`. A leak
 * under `/tmp` is invisible until the disk fills; a leak here is one `git status`/`du` away, and `git clean`
 * reaches it. That visibility is the point — this hook removes the root on a clean exit, but a killed run
 * (Ctrl+C, an OOM, a crashed worker) still leaves it behind, and it should be findable when it does.
 *
 * @returns The teardown that removes the root. Vitest awaits it after the last suite.
 * @sideEffect Creates a directory, mutates `process.env.TMPDIR`, and removes the directory on teardown.
 */
export default function setup() {
    // Workers inherit the environment from this process, so setting it here reaches every suite.
    const root = path.resolve(process.cwd(), '.tmp-test');

    mkdirSync(root, { recursive: true });

    // A per-run subdirectory: two packages' suites can run concurrently under turbo, and a shared teardown
    // that removed the whole root would delete a sibling run's directories mid-test.
    const runRoot = mkdtempSync(path.join(root, 'run-'));

    process.env['TMPDIR'] = runRoot;

    return () => {
        // ⚠️ `force` so a run that created nothing does not fail teardown, and never `recursive: false` —
        // the whole point is that the contents are unknown.
        rmSync(runRoot, { recursive: true, force: true });
    };
}

/** Where this run's temp directories live. Exported so a fixture can assert the confinement holds. */
export const testTempRoot = () => process.env['TMPDIR'] ?? os.tmpdir();
