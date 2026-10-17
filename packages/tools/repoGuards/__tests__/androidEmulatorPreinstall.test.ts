// @vitest-environment node
/**
 * ⛔ The Android Maestro shard downloads the emulator and its system image in a RETRIED step of its own, before the
 * emulator action runs, so a transient SDK download failure costs a retry instead of the whole shard.
 *
 * ## The failure
 *
 * Run 38407211276 (2026-10-13), Android shard 3, no flow run at all. Inside `reactivecircus/android-emulator-runner`:
 *
 *     sdkmanager --install emulator --channel=0
 *     Warning: An error occurred while preparing SDK package Android Emulator: Error on ZipFile unknown archive.
 *     adb -s emulator-5554 emu kill
 *     error: could not connect to TCP port 5554: Connection refused
 *
 * The `5554` line is the action's own clean-up of an emulator it never launched; the cause is the download two lines
 * above it. The other three shards installed the same package from the same image in the same minute. It is the class
 * `androidSdkInstall.test.ts` records for the NDK, one tool over, and it reported as "E2E (mobile — Maestro) failed".
 *
 * ## Why a pre-install, and not a retry around the action
 *
 * The action also RUNS the flows, so retrying it would re-run every flow after a real red. The step here installs the
 * same packages the action installs (`emulator`, the platform and the system image, on the action's channel), so the
 * action's own `sdkmanager --install` calls then find them current and download nothing. The packages are named from
 * the SAME job-level variables the action's `api-level`, `target` and `arch` read, so the two cannot name different
 * images.
 *
 * DESIGN PATTERN: Specification over the workflow text, plus the step's own shell body executed against a stubbed
 * `sdkmanager` — the retry is a behaviour, not a reading.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';

import { scalarText } from './workflowScalar.js';

const WORKFLOW = fileURLToPath(new URL('../../../../.github/workflows/_ci-heavy.yml', import.meta.url));
const ANDROID_JOB = 'e2e-mobile-maestro';
const ACTION = 'reactivecircus/android-emulator-runner@';

interface Step {
    readonly name?: string;
    readonly if?: unknown;
    readonly uses?: string;
    readonly run?: unknown;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly with?: Readonly<Record<string, unknown>>;
}

interface Job {
    readonly env?: Readonly<Record<string, unknown>>;
    readonly steps?: readonly Step[];
}

const workflow = parse(readFileSync(WORKFLOW, 'utf8')) as { readonly jobs?: Readonly<Record<string, Job>> };
const job = workflow.jobs?.[ANDROID_JOB];
const steps = job?.steps ?? [];
const actionIndex = steps.findIndex((step) => (step.uses ?? '').startsWith(ACTION));
const action = steps[actionIndex];
const preinstallIndex = steps.findIndex((step) => /sdkmanager\b/u.test(scalarText(step.run)));
const preinstall = steps[preinstallIndex];

/** The job-level variable a `${{ env.NAME }}` value reads, or `undefined` when the value is anything else. */
function envReference(value: unknown): string | undefined {
    return /^\$\{\{ env\.(\w+) \}\}$/u.exec(scalarText(value))?.[1];
}

const scratch: string[] = [];

afterAll(() => {
    for (const directory of scratch) {
        rmSync(directory, { recursive: true, force: true });
    }
});

/**
 * Run the pre-install step's own body against a stubbed `sdkmanager` that fails its first `failures` install calls.
 *
 * @sideEffect Writes stubs and a script to a scratch directory and spawns bash.
 */
function runPreinstall(failures: number): { readonly status: number; readonly output: string; readonly calls: string } {
    const dir = mkdtempSync(join(tmpdir(), 'android-preinstall-'));

    scratch.push(dir);

    const sdk = join(dir, 'sdk');
    const calls = join(dir, 'calls.log');
    const counter = join(dir, 'failures-left');

    // The stub lives where the image keeps the tool, and NOT on PATH: the step runs before the action adds it there.
    const bin = join(sdk, 'cmdline-tools', 'latest', 'bin');

    mkdirSync(bin, { recursive: true });
    writeFileSync(calls, '');
    writeFileSync(counter, String(failures));
    writeFileSync(
        join(bin, 'sdkmanager'),
        [
            '#!/usr/bin/env bash',
            `printf '%s\\n' "$*" >> "${calls}"`,
            'case "$1" in --licenses) head -c 64 > /dev/null; exit 0 ;; esac',
            `left=$(cat "${counter}")`,
            'if [ "$left" -gt 0 ]; then',
            `  echo $((left - 1)) > "${counter}"`,
            "  echo 'Warning: An error occurred while preparing SDK package Android Emulator: Error on ZipFile unknown archive.' >&2",
            '  exit 1',
            'fi',
            // A successful install leaves the packages on disk, as the real tool does.
            `mkdir -p "${sdk}/emulator" "${sdk}/system-images/android-$ANDROID_EMULATOR_API_LEVEL/$ANDROID_EMULATOR_TARGET/$ANDROID_EMULATOR_ARCH"`,
            `printf '#!/bin/sh\\n' > "${sdk}/emulator/emulator"; chmod +x "${sdk}/emulator/emulator"`,
            'exit 0',
        ].join('\n'),
    );
    writeFileSync(join(dir, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(join(bin, 'sdkmanager'), 0o755);
    chmodSync(join(dir, 'sleep'), 0o755);
    writeFileSync(join(dir, 'step.sh'), scalarText(preinstall?.run));

    const env: Record<string, string> = {
        PATH: `${dir}:${process.env['PATH'] ?? ''}`,
        HOME: dir,
        ANDROID_HOME: sdk,
    };

    for (const [key, value] of Object.entries(job?.env ?? {})) {
        if (!scalarText(value).includes('${{')) {
            env[key] = scalarText(value);
        }
    }

    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', 'step.sh'], {
        cwd: dir,
        encoding: 'utf8',
        env,
    });

    return {
        status: result.status ?? -1,
        output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
        calls: readFileSync(calls, 'utf8'),
    };
}

describe('⛔ the Android shard installs the emulator toolchain in a retried step before the emulator action', () => {
    it('finds the emulator action and a pre-install step (non-vacuity)', () => {
        expect(actionIndex, `${ANDROID_JOB} has no ${ACTION} step`).toBeGreaterThan(-1);
        expect(preinstallIndex, `${ANDROID_JOB} has no step that runs sdkmanager`).toBeGreaterThan(-1);
    });

    it('runs BEFORE the emulator action, and after the disk is freed for the system image', () => {
        const freeDisk = steps.findIndex((step) => /Free disk space/u.test(step.name ?? ''));

        expect(preinstallIndex).toBeLessThan(actionIndex);
        expect(preinstallIndex).toBeGreaterThan(freeDisk);
        expect(scalarText(preinstall?.if)).toBe(scalarText(action?.if));
    });

    it('⛔ the action and the pre-install name the image from ONE set of job-level variables', () => {
        const apiLevel = envReference(action?.with?.['api-level']);
        const target = envReference(action?.with?.['target']);
        const arch = envReference(action?.with?.['arch']);

        expect([apiLevel, target, arch]).toStrictEqual([
            'ANDROID_EMULATOR_API_LEVEL',
            'ANDROID_EMULATOR_TARGET',
            'ANDROID_EMULATOR_ARCH',
        ]);

        for (const name of [apiLevel, target, arch]) {
            expect(scalarText(job?.env?.[name ?? '']), `job env has no ${String(name)}`).not.toBe('');
        }

        // The pre-install reads the same names; it may not carry a literal of its own.
        const body = scalarText(preinstall?.run);

        expect(body).toContain('${ANDROID_EMULATOR_API_LEVEL}');
        expect(body).toContain('${ANDROID_EMULATOR_TARGET}');
        expect(body).toContain('${ANDROID_EMULATOR_ARCH}');
        expect(body).not.toMatch(/android-\d/u);
    });

    it('installs what the action installs, on the action’s channel', () => {
        const outcome = runPreinstall(0);
        const level = scalarText(job?.env?.['ANDROID_EMULATOR_API_LEVEL']);
        const target = scalarText(job?.env?.['ANDROID_EMULATOR_TARGET']);
        const arch = scalarText(job?.env?.['ANDROID_EMULATOR_ARCH']);

        expect(outcome.status, outcome.output).toBe(0);
        // The action's `channel` input is unset, which its own action.yml defaults to `stable` (channel 0).
        expect(action?.with?.['channel']).toBeUndefined();
        expect(outcome.calls).toContain('--install emulator --channel=0');
        expect(outcome.calls).toContain(`--install platforms;android-${level} --channel=0`);
        expect(outcome.calls).toContain(`--install system-images;android-${level};${target};${arch} --channel=0`);
    });

    it('⛔ survives a transient download failure by retrying', () => {
        const outcome = runPreinstall(2);

        expect(outcome.status, outcome.output).toBe(0);
        expect(outcome.calls.match(/--install emulator /gu)?.length ?? 0).toBeGreaterThan(1);
    });

    it('⛔ fails LOUDLY, naming the toolchain rather than the flows, when every attempt fails', () => {
        const outcome = runPreinstall(99);

        expect(outcome.status).not.toBe(0);
        expect(outcome.output).toMatch(/::error::.*emulator.*(download|install)/iu);
    });
});
