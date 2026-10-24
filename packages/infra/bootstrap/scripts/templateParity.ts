/**
 * The template-parity proof for moving every stage app onto KitchenSink's qualifier and permissions boundary
 *: the synthesized CloudFormation must differ from the base ONLY in the three ways the move is meant
 * to differ, and in nothing else. In particular no logical id may change (a changed id replaces the resource, and
 * for the prod database or a RETAIN bucket that is data loss, ADR-0002).
 *
 * ## Why a script and not a unit test
 *
 * Both halves need every app synthesized as a real entrypoint at three stages, with Lambda bundles built. That
 * takes minutes and a built tree, so it cannot run in the unit tier. The COMPARISON is a pure function with unit
 * tests (`__tests__/templateParity.test.ts`); this script supplies the two cloud assemblies. The result is not
 * committed: a committed result would be a snapshot of one commit and could only go stale. The proof is a command
 * anyone re-runs against any two commits.
 *
 * ## Usage
 *
 *   tsx scripts/templateParity.ts capture <dir>            synthesize every app at prod, sandbox, pr-1 into <dir>
 *   tsx scripts/templateParity.ts compare <baseDir> <dir>  compare two captures; exits non-zero on any difference
 *
 * Capture on the base commit, capture on the branch, then compare.
 *
 * @sideEffect `capture` spawns child processes and writes the directory; it also builds the global app's bundles.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareCaptures, type Capture } from '../src/templateParity.js';
import {
    ACCOUNT_APP,
    REPO_ROOT,
    buildGlobalBundles,
    discoverStageApps,
    placeholderEnvironment,
} from './deriveResourceTypes.js';

/** The stages every stage app is proved at: the two tiers, and a per-PR preview. */
export const PARITY_STAGES = ['prod', 'sandbox', 'pr-1'] as const;

/** An app may refuse a stage on purpose (the food and recipe services have no persistent `sandbox`). */
const DELIBERATE_REFUSAL = /Refusing to (?:deploy|synthesize)/u;

const slug = (app: string): string =>
    app.replace(/\/infra\/bin\/app\.ts$|\/bin\/app\.ts$|\.ts$/u, '').replaceAll('/', '__');

/**
 * Synthesizes one app at one stage into `dest`.
 *
 * @returns True when it synthesized, false when the app refused the stage on purpose.
 * @throws When it fails for any other reason: a capture that skipped an app would be a proof that passes over it.
 */
function captureOne(app: string, stage: string, dest: string): boolean {
    const outdir = mkdtempSync(path.join(tmpdir(), 'ksParity-'));

    try {
        const cwd = path.join(REPO_ROOT, path.dirname(path.dirname(app)));
        const result = spawnSync('npx', ['tsx', path.join(REPO_ROOT, app)], {
            cwd,
            env: placeholderEnvironment(stage, outdir),
            encoding: 'utf8',
            timeout: 280_000,
        });

        if (result.status !== 0) {
            if (DELIBERATE_REFUSAL.test(result.stderr)) {
                return false;
            }

            throw new Error(`${app} @ ${stage} failed to synthesize:\n${result.stderr.slice(-2000)}`);
        }

        mkdirSync(dest, { recursive: true });

        for (const file of readdirSync(outdir)) {
            if (file.endsWith('.template.json') || file.endsWith('.assets.json') || file === 'manifest.json') {
                copyFileSync(path.join(outdir, file), path.join(dest, file));
            }
        }

        return true;
    } finally {
        rmSync(outdir, { recursive: true, force: true });
    }
}

/** Reads one capture directory back into the shape the comparator takes. */
export function readCapture(dir: string): Capture {
    const capture: Record<string, Record<string, unknown>> = Object.create(null) as Record<
        string,
        Record<string, unknown>
    >;

    for (const appDir of readdirSync(dir)) {
        for (const stage of readdirSync(path.join(dir, appDir))) {
            const files: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
            const stageDir = path.join(dir, appDir, stage);

            for (const file of readdirSync(stageDir)) {
                files[file] = JSON.parse(readFileSync(path.join(stageDir, file), 'utf8')) as unknown;
            }

            capture[`${appDir}/${stage}`] = files;
        }
    }

    return capture;
}

/** @sideEffect Synthesizes every app and writes the capture directory. */
function capture(dir: string): void {
    buildGlobalBundles();
    const apps = [...discoverStageApps(REPO_ROOT)];
    const seen = new Map<string, boolean>();

    for (const app of apps) {
        for (const stage of PARITY_STAGES) {
            const ok = captureOne(app, stage, path.join(dir, slug(app), stage));
            seen.set(app, (seen.get(app) ?? false) || ok);
        }
    }

    for (const [app, ok] of seen) {
        if (!ok) {
            throw new Error(`${app} refused every stage it was asked to synthesize at`);
        }
    }

    // The account app takes no stage. It is captured once, so the proof shows it did NOT move.
    if (!captureOne(ACCOUNT_APP, 'account', path.join(dir, slug(ACCOUNT_APP), 'account'))) {
        throw new Error('the account app refused to synthesize');
    }
}

/** @sideEffect Reads two capture directories and prints the differences. Sets a non-zero exit code on any. */
function compare(baseDir: string, headDir: string): void {
    const report = compareCaptures(readCapture(baseDir), readCapture(headDir));

    for (const line of report.summary) {
        process.stdout.write(`${line}\n`);
    }

    if (report.differences.length > 0) {
        for (const difference of report.differences) {
            process.stderr.write(`DIFFERENCE ${difference}\n`);
        }

        process.exitCode = 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [mode, first, second] = process.argv.slice(2);

    if (mode === 'capture' && first !== undefined) {
        capture(path.resolve(first));
    } else if (mode === 'compare' && first !== undefined && second !== undefined && existsSync(first)) {
        compare(path.resolve(first), path.resolve(second));
    } else {
        process.stderr.write('usage: templateParity.ts capture <dir> | compare <baseDir> <dir>\n');
        process.exitCode = 2;
    }
}
