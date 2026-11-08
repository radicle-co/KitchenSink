/**
 * THE LOCAL iOS LANES SWITCH PASSWORD AUTOFILL OFF, AS CI DOES, THROUGH THE ONE RUNNER SCRIPT.
 *
 * CI's 'Switch password AutoFill off on the iOS Simulator' step (`_ci-heavy.yml`, asserted by `maestroIosTier.test.ts`)
 * exists because iOS raises a "Save Password?" sheet over the sign-in's code step. The sheet belongs to another process,
 * so Maestro's hierarchy holds only the status bar and no flow can tap "Not Now". The local lanes never ran that step, so
 * the sheet failed the first iOS pass of the last local run (2026-10-29).
 *
 * `maestro_disable_password_autofill_ios` is the local twin. Every device-side call goes through `xcrun`, which the Mac
 * lane overrides to run over SSH, so the same function works against a Simulator on another machine (the data directory
 * is asked of the booted device, never built from the caller's `$HOME`).
 *
 * Asserted by RUNNING the function with `xcrun` stubbed. A second test holds the three profile files equal to CI's, so
 * the two copies of that list cannot drift apart unnoticed.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const SCRIPT = path.join(repoRoot, 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh');
const WORKFLOW = path.join(repoRoot, '.github/workflows/_ci-heavy.yml');
const DATA = '/sim/data';
const scratch = mkdtempSync(path.join(tmpdir(), 'passwordAutofill-'));

const PROFILE_FILES = [
    'Containers/Shared/SystemGroup/systemgroup.com.apple.configurationprofiles/Library/ConfigurationProfiles/UserSettings.plist',
    'Library/UserConfigurationProfiles/EffectiveUserSettings.plist',
    'Library/UserConfigurationProfiles/PublicInfo/PublicEffectiveUserSettings.plist',
];

afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
});

/**
 * Source the runner with `xcrun` stubbed to log its arguments, run `body`, and return the log.
 *
 * @param body - Shell commands run after the script is sourced.
 * @param readBack - What a stubbed `plutil -extract` prints.
 * @returns The exit status and every stubbed call, one per line.
 * @sideEffect Spawns bash and writes a log under the suite's temp dir.
 */
function run(body: string, readBack = 'false'): { readonly status: number | null; readonly calls: readonly string[] } {
    const log = path.join(scratch, `calls-${String(Math.random()).slice(2)}.log`);
    // The paths travel in the environment, so no value is spliced into the shell text.
    const stub = [
        'xcrun() { echo "xcrun $*" >> "$STUB_LOG"; case "$*" in',
        '  "simctl getenv"*) echo "$STUB_DATA";;',
        `  *'plutil -extract'*) echo "$STUB_READ_BACK";;`,
        'esac; }',
    ].join('\n');
    const result = spawnSync('bash', ['-c', `${stub}\n. "$STUB_SCRIPT"\n${body}`], {
        encoding: 'utf8',
        env: { ...process.env, STUB_LOG: log, STUB_DATA: DATA, STUB_READ_BACK: readBack, STUB_SCRIPT: SCRIPT },
    });

    let calls: readonly string[] = [];

    try {
        calls = readFileSync(log, 'utf8').split('\n').filter(Boolean);
    } catch {
        // No stub was called, so the log was never written.
    }

    return { status: result.status, calls };
}

describe('maestro_disable_password_autofill_ios', () => {
    it('⛔ writes NO into each of the three profile files while the device is SHUT DOWN, then boots it again', () => {
        const { status, calls } = run('MAESTRO_IOS_UDID=SIM-1 maestro_disable_password_autofill_ios');
        const shutdown = calls.indexOf('xcrun simctl shutdown SIM-1');
        const boot = calls.lastIndexOf('xcrun simctl boot SIM-1');

        expect(status).toBe(0);
        expect(shutdown).toBeGreaterThanOrEqual(0);

        for (const file of PROFILE_FILES) {
            const write = calls.indexOf(
                `xcrun plutil -replace restrictedBool.allowPasswordAutoFill.value -bool NO ${DATA}/${file}`,
            );

            // A write under a RUNNING device changes the file and not the device (CI run 38433716728).
            expect(write, file).toBeGreaterThan(shutdown);
            expect(write, file).toBeLessThan(boot);
        }

        expect(boot).toBeGreaterThan(shutdown);
        expect(calls.at(-1)).toBe('xcrun simctl bootstatus SIM-1 -b');
    });

    it('asks the device for its data directory instead of building it from the caller HOME', () => {
        const { calls } = run('MAESTRO_IOS_UDID=SIM-1 maestro_disable_password_autofill_ios');

        expect(calls).toContain('xcrun simctl getenv SIM-1 HOME');
        expect(calls.join('\n')).not.toContain(process.env['HOME'] ?? '/nonexistent-home');
    });

    it('⛔ fails when no file reads back NO afterwards, so a sheet is never left to surprise a flow', () => {
        expect(run('MAESTRO_IOS_UDID=SIM-1 maestro_disable_password_autofill_ios', 'true').status).not.toBe(0);
    });

    it('refuses to guess the Simulator', () => {
        const { status, calls } = run('MAESTRO_IOS_UDID= maestro_disable_password_autofill_ios');

        expect(status).not.toBe(0);
        expect(calls).toEqual([]);
    });

    it('⛔ names the same three profile files CI writes, so the two lists cannot drift', () => {
        const workflow = readFileSync(WORKFLOW, 'utf8');
        const script = readFileSync(SCRIPT, 'utf8');

        for (const file of PROFILE_FILES) {
            expect(workflow, `${file} is not in _ci-heavy.yml`).toContain(file);
            expect(script, `${file} is not in runMaestroFlows.sh`).toContain(file);
        }
    });
});
