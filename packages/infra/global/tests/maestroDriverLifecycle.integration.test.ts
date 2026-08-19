/**
 * ⛔ THE ACCEPTANCE CRITERION for the pairing that makes a STATIC Maestro driver port safe.
 *
 * ## The two halves, and why neither is correct alone
 *
 * Maestro picks the driver port on the HOST (`ServerSocket(0)`) and then imposes it on the DEVICE, with no
 * retry when the device-side `bind()` fails. Pinning the port below the kernel's ephemeral range removes
 * that collision class — `__tests__/maestroDriverPort.test.ts` asserts the range.
 *
 * But a fixed port is only an improvement if the port is reliably FREE when the next flow starts. Maestro
 * closes its driver from a JVM shutdown hook gated on a session heartbeat, and in the failing run's own logs
 * 21 of 26 flows recorded no cleanup line at all while the other 5 stopped at `[Start] Uninstall driver` with
 * no `[Done]`. If a driver ever survives its flow, a FIXED port hands it to the next flow deterministically —
 * converting a 1-in-188 flake into a red run every time, which is strictly worse than drawing a random
 * number. So the runner tears the driver down itself, before each flow, rather than trusting that hook.
 *
 * ## Why this is an integration test rather than a source grep
 *
 * The invariant is ORDERING — teardown must precede `maestro test` — and a grep cannot see order. So the
 * flow loop is executed as real `bash` with `adb`, `maestro` and `node` replaced by stubs on `PATH` that
 * record their own argv. Nothing here touches a device, an emulator or a network; it proves the script's
 * behaviour, which is the thing that was wrong.
 */
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'packages/apps/commise/mobile/tests/e2e/run-maestro-flows.sh');

/** Every stubbed command appends `<name>\t<argv…>` here, in invocation order. */
let calls: string[] = [];
let stdout = '';

/**
 * Write an executable stub that records its own invocation and exits 0.
 *
 * @param dir - The directory to place it in (prepended to `PATH`).
 * @param name - The command to shadow.
 * @param log - The file the stub appends to.
 * @sideEffect Writes and chmods a file.
 */
function stub(dir: string, name: string, log: string): void {
    const path = join(dir, name);

    writeFileSync(path, `#!/usr/bin/env bash\nprintf '%s\\t%s\\n' "${name}" "$*" >> "${log}"\nexit 0\n`, 'utf8');
    chmodSync(path, 0o755);
}

beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'maestro-lifecycle-'));
    const log = join(dir, 'calls.log');

    writeFileSync(log, '', 'utf8');

    for (const name of ['adb', 'maestro', 'node']) {
        stub(dir, name, log);
    }

    // Run ONE flow through the real loop. `run-one` keeps the harness honest: the loop under test is the
    // same one CI runs, not a reimplementation.
    const result = spawnSync('bash', [SCRIPT, 'run-one', 'recipes/discover-clone'], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${dir}:${process.env['PATH'] ?? ''}` },
    });

    stdout = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    calls = existsSync(log)
        ? readFileSync(log, 'utf8')
              .split('\n')
              .filter((line) => line.trim().length > 0)
        : [];
}, 60_000);

/** The index of the first recorded call matching `pattern`, or -1. */
const indexOf = (pattern: RegExp): number => calls.findIndex((call) => pattern.test(call));

describe('maestro driver lifecycle', () => {
    it('runs the flow at all — the harness is not vacuous', () => {
        // Guards every ordering assertion below: if the loop never reached `maestro test`, "teardown came
        // first" would be trivially true and prove nothing.
        expect(calls.length, `no stub was invoked; stdout was:\n${stdout}`).toBeGreaterThan(0);
        expect(indexOf(/^maestro\t.*\btest\b/)).toBeGreaterThan(-1);
    });

    it('⛔ passes the pinned driver port to maestro', () => {
        const invocation = calls.find((call) => /^maestro\t.*\btest\b/.test(call)) ?? '';

        expect(invocation).toContain('--driver-host-port');
    });

    it('⛔ tears the driver down BEFORE the flow, not after', () => {
        // The ordering that makes a fixed port safe. Cleanup afterwards would still leave the NEXT flow
        // exposed whenever a run dies mid-flow — which is precisely the case that leaks a driver.
        const teardown = indexOf(/^adb\t.*(uninstall|force-stop).*maestro/i);
        const test = indexOf(/^maestro\t.*\btest\b/);

        expect(teardown, 'no adb teardown of the maestro driver was recorded').toBeGreaterThan(-1);
        expect(teardown).toBeLessThan(test);
    });

    it('⛔ logs the driver port, so the next failure names it without an artifact download', () => {
        // The single highest-value diagnostic: answering "which port did this flow use?" required
        // downloading and unzipping the run artifact. It belongs in the CI log.
        expect(stdout).toMatch(/driver port/i);
    });
});
