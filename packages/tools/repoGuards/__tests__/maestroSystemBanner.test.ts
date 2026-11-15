/**
 * THE LOCAL iOS LANES SWITCH THE "READY FOR APPLE INTELLIGENCE" BANNER OFF, AND READ IT BACK.
 *
 * About 25 s after a Simulator boots, `generativeexperiencesd` posts a FollowUp banner over whatever app is in front. The
 * banner is another process's, so Maestro's hierarchy cannot tap it away, and the next tap can open Settings instead of
 * Commise (the detailBack flake). The LB.U1 spike found the switch: `launchctl disable` on that daemon inside the booted
 * Simulator. Cause, command and red/green runs: the spike record in the Luna squad folder (`reviews/0001-LB-spike.md`).
 *
 * `maestro_disable_apple_intelligence_banner_ios` is asserted by RUNNING it with `xcrun` stubbed. The READ-BACK decides:
 * a `disable` that exits 0 while the daemon is still enabled must fail the lane's setup (a missed switch looks like a
 * passing setup and then a VOID flow).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const SCRIPT = path.join(repoRoot, 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh');
const DAEMON = 'com.apple.generativeexperiencesd';
const scratch = mkdtempSync(path.join(tmpdir(), 'systemBanner-'));

afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
});

const DISABLED = `\t\t"${DAEMON}" => disabled`;
const ENABLED = `\t\t"${DAEMON}" => enabled`;

/**
 * Source the runner with `xcrun` stubbed to log its arguments, run `body`, and return the log.
 *
 * @param body - Shell commands run after the script is sourced.
 * @param readBack - What a stubbed `launchctl print-disabled` prints.
 * @param bootoutStatus - The status a stubbed `launchctl bootout` returns.
 * @returns The exit status and every stubbed call, one per line.
 * @sideEffect Spawns bash and writes a log under the suite's temp dir.
 */
function run(
    body: string,
    readBack = DISABLED,
    bootoutStatus = 0,
): { readonly status: number | null; readonly calls: readonly string[] } {
    const log = path.join(scratch, `calls-${String(Math.random()).slice(2)}.log`);
    const stub = [
        'xcrun() { echo "xcrun $*" >> "$STUB_LOG"; case "$*" in',
        '  *"launchctl print-disabled"*) printf "%s\\n" "$STUB_READ_BACK";;',
        '  *"launchctl bootout"*) return "$STUB_BOOTOUT";;',
        'esac; }',
    ].join('\n');
    const result = spawnSync('bash', ['-c', `${stub}\n. "$STUB_SCRIPT"\n${body}`], {
        encoding: 'utf8',
        env: {
            ...process.env,
            STUB_LOG: log,
            STUB_READ_BACK: readBack,
            STUB_BOOTOUT: String(bootoutStatus),
            STUB_SCRIPT: SCRIPT,
        },
    });

    let calls: readonly string[] = [];

    try {
        calls = readFileSync(log, 'utf8').split('\n').filter(Boolean);
    } catch {
        // No stub was called, so the log was never written.
    }

    return { status: result.status, calls };
}

describe('maestro_disable_apple_intelligence_banner_ios', () => {
    it('⛔ disables the daemon on the named Simulator, then reads the disabled list back', () => {
        const { status, calls } = run('MAESTRO_IOS_UDID=SIM-1 maestro_disable_apple_intelligence_banner_ios');
        const disable = calls.indexOf(`xcrun simctl spawn SIM-1 launchctl disable system/${DAEMON}`);
        const readBack = calls.indexOf('xcrun simctl spawn SIM-1 launchctl print-disabled system');

        expect(status).toBe(0);
        expect(disable).toBeGreaterThanOrEqual(0);
        // The read-back is what decides, so it must come after the write.
        expect(readBack).toBeGreaterThan(disable);
    });

    it('⛔ fails when the read-back still shows the daemon enabled, whatever the disable exit status was', () => {
        expect(run('MAESTRO_IOS_UDID=SIM-1 maestro_disable_apple_intelligence_banner_ios', ENABLED).status).not.toBe(
            0,
        );
    });

    it('⛔ fails when the daemon is missing from the read-back, so an unreadable answer never passes', () => {
        expect(run('MAESTRO_IOS_UDID=SIM-1 maestro_disable_apple_intelligence_banner_ios', '').status).not.toBe(0);
    });

    it('does not fail the setup when the daemon is not running yet (bootout: no such process)', () => {
        expect(run('MAESTRO_IOS_UDID=SIM-1 maestro_disable_apple_intelligence_banner_ios', DISABLED, 3).status).toBe(0);
    });

    it('refuses to guess the Simulator', () => {
        const { status, calls } = run('MAESTRO_IOS_UDID= maestro_disable_apple_intelligence_banner_ios');

        expect(status).not.toBe(0);
        expect(calls).toEqual([]);
    });
});
