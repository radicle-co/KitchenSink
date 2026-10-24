/**
 * EVERY MAESTRO DEVICE RUNS WITH MOTION OFF, ON BOTH PLATFORMS, THROUGH THE ONE RUNNER SCRIPT.
 *
 * Owner ruling, 2026-10-20: nothing in the app or its tests may depend on how fast or slow a transition runs, and a bug
 * that occurs only while an animation plays is acceptable for now. Maestro waits for an element to EXIST, not for it to
 * stop moving or to be uncovered, so a tap on a sheet still sliding in did nothing (CI run 39504625987, iOS shard 3;
 * local runs the same day, `ingredientRemove`), and the suite grew 153 `waitForAnimationToEnd` steps and retries to
 * paper over it. The app already skips a sheet's slide and a dialog's fade when the device reports Reduce Motion
 * (`sheetPresentation.ts`, `dialogFrameLayout.ts`), so the devices report it.
 *
 * - Android: the three animation scales go to 0. React Native reports Reduce Motion when the transition scale is 0, and
 *   the window and animator scales stop the platform's own transitions. Read back, so the log says what the device holds.
 * - iOS: `com.apple.Accessibility ReduceMotionEnabled` is written THROUGH THE BOOTED DEVICE (`simctl spawn`). Measured on
 *   the Mac, 2026-10-20: the same key written into the preferences plist before the first boot read back `0` after it,
 *   and the sheet slid; written through the booted device it read back `1`, survived a reboot, and the sheet appeared in
 *   one frame with no reboot needed.
 *
 * Asserted by RUNNING the functions with `adb` and `xcrun` stubbed, so the guard checks the commands, not their spelling.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const SCRIPT = path.join(repoRoot, 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh');
const scratch = mkdtempSync(path.join(tmpdir(), 'reduceMotion-'));

afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
});

/**
 * Source the runner with `adb` and `xcrun` stubbed to log their arguments, run `body`, and return the log.
 *
 * @param body - Shell commands run after the script is sourced.
 * @param answer - What a stubbed `settings get` / `defaults read` prints.
 * @returns The exit status and every stubbed call, one per line.
 * @sideEffect Spawns bash and writes a log under the suite's temp dir.
 */
function run(body: string, answer = '0'): { readonly status: number | null; readonly calls: readonly string[] } {
    const log = path.join(scratch, `calls-${String(Math.random()).slice(2)}.log`);
    const stubs = [
        `adb() { echo "adb $*" >> '${log}'; case "$*" in *' get '*) echo '${answer}';; esac; }`,
        `xcrun() { echo "xcrun $*" >> '${log}'; case "$*" in *' read '*) echo '${answer}';; esac; }`,
    ].join('\n');
    const result = spawnSync('bash', ['-c', `${stubs}\n. '${SCRIPT}'\n${body}`], { encoding: 'utf8' });

    return { status: result.status, calls: callsIn(log) };
}

/**
 * The stubbed calls a run logged, or none when the body called no stub (the log is then never written).
 *
 * @param log - The run's log file.
 * @returns One call per line.
 * @sideEffect Reads the log file.
 */
function callsIn(log: string): readonly string[] {
    try {
        return readFileSync(log, 'utf8').split('\n').filter(Boolean);
    } catch {
        return [];
    }
}

describe('Maestro devices run with motion off', () => {
    describe('Android', () => {
        const { status, calls } = run('maestro_android_input_settings');

        it('settles the device without failing', () => {
            expect(status).toBe(0);
        });

        it.each(['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'])(
            '⛔ sets %s to 0',
            (scale) => {
                expect(calls).toContain(`adb shell settings put global ${scale} 0`);
            },
        );

        it('reads the transition scale back, the one React Native reads Reduce Motion from', () => {
            expect(calls).toContain('adb shell settings get global transition_animation_scale');
        });
    });

    describe('iOS', () => {
        it('⛔ writes Reduce Motion through the booted Simulator, then reads it back', () => {
            const { status, calls } = run('MAESTRO_IOS_UDID=SIM-1 maestro_reduce_motion_ios', '1');

            expect(status).toBe(0);
            expect(calls).toEqual([
                'xcrun simctl spawn SIM-1 defaults write com.apple.Accessibility ReduceMotionEnabled -bool true',
                'xcrun simctl spawn SIM-1 defaults read com.apple.Accessibility ReduceMotionEnabled',
            ]);
        });

        it('⛔ fails when the Simulator does not hold it, so a run never silently animates', () => {
            expect(run('MAESTRO_IOS_UDID=SIM-1 maestro_reduce_motion_ios', '0').status).not.toBe(0);
        });

        it('refuses to guess the Simulator', () => {
            const { status, calls } = run('MAESTRO_IOS_UDID= maestro_reduce_motion_ios', '1');

            expect(status).not.toBe(0);
            expect(calls).toEqual([]);
        });

        it('⛔ is set before the app is installed, in the device preparation CI runs', () => {
            const { calls } = run(
                `MAESTRO_IOS_UDID=SIM-1 MAESTRO_IOS_APP='${scratch}' maestro_prepare_device ios`,
                '1',
            );
            const write = calls.findIndex((call) => call.includes('ReduceMotionEnabled -bool true'));
            const install = calls.findIndex((call) => call.startsWith('xcrun simctl install'));

            expect(write).toBeGreaterThanOrEqual(0);
            expect(install).toBeGreaterThan(write);
        });
    });
});
