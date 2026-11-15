/**
 * THE LOCAL iOS LANES SWITCH THE "READY FOR APPLE INTELLIGENCE" BANNER OFF, AND READ IT BACK.
 *
 * About 25 s after a Simulator boots, `generativeexperiencesd` posts a FollowUp banner over whatever app is in front. The
 * banner is another process's, so Maestro's hierarchy cannot tap it away, and the next tap can open Settings instead of
 * Commise. The switch is `launchctl disable` on that daemon inside the booted Simulator.
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

const CALL = 'MAESTRO_IOS_UDID=SIM-1 maestro_disable_apple_intelligence_banner_ios';
const DISABLED = `\t\t"${DAEMON}" => disabled`;
const ENABLED = `\t\t"${DAEMON}" => enabled`;

/**
 * Source the runner with `xcrun` stubbed to log its arguments, run `body`, and return the log.
 *
 * @param body - Shell commands run after the script is sourced.
 * @param readBack - What a stubbed `launchctl print-disabled` prints.
 * @param bootoutStatus - The status a stubbed `launchctl bootout` returns.
 * @param disableStatus - The status a stubbed `launchctl disable` returns.
 * @param padLines - How many other-daemon lines the stubbed `print-disabled` prints after the read-back.
 * @returns The exit status, its output, and every stubbed call, one per line.
 * @sideEffect Spawns bash and writes a log under the suite's temp dir.
 */
function run(
    body: string,
    readBack = DISABLED,
    bootoutStatus = 0,
    disableStatus = 0,
    padLines = 0,
): { readonly status: number | null; readonly output: string; readonly calls: readonly string[] } {
    const log = path.join(scratch, `calls-${String(Math.random()).slice(2)}.log`);
    const stub = [
        'xcrun() { echo "xcrun $*" >> "$STUB_LOG"; case "$*" in',
        '  *"launchctl print-disabled"*) printf "%s\\n" "$STUB_READ_BACK"',
        // After the read-back, STUB_PAD other-daemon lines: a long listing, with the match first.
        `    awk -v n="$STUB_PAD" 'BEGIN { for (i = 0; i < n; i++) print "\\t\\t\\"com.apple.pad\\" => enabled" }';;`,
        '  *"launchctl disable"*) return "$STUB_DISABLE";;',
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
            STUB_DISABLE: String(disableStatus),
            STUB_PAD: String(padLines),
            STUB_SCRIPT: SCRIPT,
        },
    });

    let calls: readonly string[] = [];

    try {
        calls = readFileSync(log, 'utf8').split('\n').filter(Boolean);
    } catch {
        // No stub was called, so the log was never written.
    }

    return { status: result.status, output: `${result.stdout}${result.stderr}`, calls };
}

describe('maestro_disable_apple_intelligence_banner_ios', () => {
    it('⛔ disables the daemon on the named Simulator, then reads the disabled list back', () => {
        const { status, calls } = run(CALL);
        const disable = calls.indexOf(`xcrun simctl spawn SIM-1 launchctl disable system/${DAEMON}`);
        const readBack = calls.indexOf('xcrun simctl spawn SIM-1 launchctl print-disabled system');

        expect(status).toBe(0);
        expect(disable).toBeGreaterThanOrEqual(0);
        // The read-back is what decides, so it must come after the write.
        expect(readBack).toBeGreaterThan(disable);
    });

    it('⛔ fails when the read-back shows the daemon enabled, although the disable exited 0', () => {
        const { status, calls } = run(CALL, ENABLED);

        // 127 is bash's "command not found": a failure for the wrong reason. The read-back must have run and decided.
        expect(calls).toContain(`xcrun simctl spawn SIM-1 launchctl disable system/${DAEMON}`);
        expect(calls).toContain('xcrun simctl spawn SIM-1 launchctl print-disabled system');
        expect(status).not.toBe(0);
        expect(status).not.toBe(127);
    });

    it('⛔ fails when the daemon is missing from a read-back that lists other daemons', () => {
        const { status, calls } = run(
            CALL,
            '\t\t"com.apple.foo" => disabled\n\t\t"com.apple.generativeexperiencesd.other" => enabled',
        );

        expect(calls).toContain('xcrun simctl spawn SIM-1 launchctl print-disabled system');
        expect(status).not.toBe(0);
        expect(status).not.toBe(127);
    });

    it('⛔ fails when the name differs by one character where the dot is, or has a prefix, so the pattern is exact', () => {
        for (const readBack of [
            '\t\t"comXapple.generativeexperiencesd" => disabled',
            '\t\t"com.appleXgenerativeexperiencesd" => disabled',
            `\t\t"${DAEMON}.other" => disabled`,
            `x\t\t"${DAEMON}" => disabled`,
            `\t\t"${DAEMON}" => disabled extra`,
        ]) {
            const { status } = run(CALL, readBack);

            expect(status, readBack).not.toBe(0);
            expect(status, readBack).not.toBe(127);
        }
    });

    it('⛔ passes when the daemon line is first and the listing is far longer than a pipe buffer (no SIGPIPE under pipefail)', () => {
        // 60,000 lines is about 2 MB: `grep -q` leaves at the first match while the writer still has most of it to send.
        const { status } = run(CALL, DISABLED, 0, 0, 60_000);

        expect(status).toBe(0);
    });

    it('lets the read-back decide: a disable that exits non-zero passes when the daemon reads back disabled', () => {
        expect(run(CALL, DISABLED, 0, 1).status).toBe(0);
    });

    it('does not fail the setup when the daemon is not running yet (bootout: no such process)', () => {
        expect(run(CALL, DISABLED, 3).status).toBe(0);
    });

    it('refuses to guess the Simulator, and says so', () => {
        const { status, output, calls } = run('MAESTRO_IOS_UDID= maestro_disable_apple_intelligence_banner_ios');

        expect(status).not.toBe(0);
        expect(status).not.toBe(127);
        expect(output).toContain('needs MAESTRO_IOS_UDID');
        expect(calls).toEqual([]);
    });
});
