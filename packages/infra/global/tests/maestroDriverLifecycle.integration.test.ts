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
 * ## The second invariant: the ARGV the loop hands Maestro
 *
 * Every fixture VALUE is a run-scoped recipe TITLE, so every one of them contains spaces. The loop built
 * those `-e KEY=VALUE` pairs by PRINTING them from a function and expanding the command substitution
 * unquoted, which splits on every space rather than only on newlines. `E2E_RECIPE_LAMB=Grilled Lamb Chops
 * a1b2` therefore reached Maestro as four arguments, and Maestro read `Grilled` as the flow path:
 *
 *     Flow path does not exist: /home/runner/work/KitchenSink/KitchenSink/Grilled
 *
 * on all thirty flows of run 34007779812, each dying in ~2s before the app was driven at all. A string
 * cannot carry argument boundaries; only an array can.
 *
 * ⛔ SO THE STUB RECORDS ONE FIELD PER ARGUMENT, tab-separated. It used to record `"$*"` — argv joined by
 * spaces — which is the very flattening under test, so the harness was structurally incapable of seeing
 * this class no matter what it asserted. And the manifest below is built by the REAL producer
 * (`deriveFixtureManifest`), not hand-written, so the values under test stay the values that ship.
 *
 * ## Why this is an integration test rather than a source grep
 *
 * Both invariants are about ORDER and BOUNDARIES — teardown must precede `maestro test`; an argument must
 * survive as one argument — and a grep can see neither. So the flow loop is executed as real `bash` with
 * `adb`, `maestro`, `node` and `npx` replaced by stubs on `PATH` that record their own argv. Nothing here
 * touches a device, an emulator or a network; it proves the script's behaviour, which is the thing that
 * was wrong.
 */
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveFixtureManifest, manifestToEnvLines } from '@kitchensink/e2e-seed';
import { beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'packages/apps/commise/mobile/tests/e2e/run-maestro-flows.sh');

/** Every stubbed command appends `<name>\t<arg>\t<arg>…` here, in invocation order. */
let calls: string[] = [];
let stdout = '';
let manifest: ReturnType<typeof deriveFixtureManifest>;

/** Arbitrary but realistic: the run key is what makes every fixture title contain spaces AND a suffix. */
const RUN_KEY = 'pr91-lifecycle';

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

    // ⛔ ONE FIELD PER ARGUMENT. `"$*"` joins argv with spaces, which is exactly the flattening the argv
    // assertions below exist to detect — a harness recording it could never fail on it.
    writeFileSync(
        path,
        `#!/usr/bin/env bash\n{ printf '%s' "${name}"; printf '\\t%s' "$@"; printf '\\n'; } >> "${log}"\nexit 0\n`,
        'utf8',
    );
    chmodSync(path, 0o755);
}

beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'maestro-lifecycle-'));
    const log = join(dir, 'calls.log');

    writeFileSync(log, '', 'utf8');

    for (const name of ['adb', 'maestro', 'node', 'npx']) {
        stub(dir, name, log);
    }

    // The manifest the loop threads into every flow, from the REAL producer — a hand-written fixture could
    // drift into values with no spaces, which is the one shape that cannot reproduce the defect.
    manifest = deriveFixtureManifest(RUN_KEY);
    const manifestFile = join(dir, 'fixture.env');

    writeFileSync(manifestFile, `${manifestToEnvLines(manifest).join('\n')}\n`, 'utf8');

    // Run ONE flow through the real loop. `run-one` keeps the harness honest: the loop under test is the
    // same one CI runs, not a reimplementation.
    const result = spawnSync('bash', [SCRIPT, 'run-one', 'recipes/discover-clone'], {
        encoding: 'utf8',
        env: {
            ...process.env,
            PATH: `${dir}:${process.env['PATH'] ?? ''}`,
            MAESTRO_FIXTURE_ENV_FILE: manifestFile,
        },
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

/** The `maestro test` invocation's arguments, with boundaries intact (the leading command is dropped). */
function maestroArgv(): readonly string[] {
    const invocation = calls.find((call) => /^maestro\ttest\b/.test(call)) ?? '';

    return invocation.split('\t').slice(1);
}

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

    it('⛔ hands each fixture pair to maestro as ONE argument, spaces and all', () => {
        // THE REGRESSION. Every value here is a run-scoped recipe title, so every one contains spaces; the
        // printed-and-word-split form turned each into several arguments. Asserting the WHOLE expected pair
        // list — in order — is what makes this falsifiable in both directions: a lost `-e`, a split value,
        // or a key silently dropped from the manifest all fail it.
        const expected = manifestToEnvLines(manifest).flatMap((pair) => ['-e', pair]);

        expect(expected.length, 'the manifest produced no pairs — the harness would be vacuous').toBeGreaterThan(0);
        expect(maestroArgv().slice(1, expected.length + 1)).toEqual(expected);
    });

    it('⛔ gives maestro exactly ONE positional argument — the flow path', () => {
        // ⚠️ ASSERTED AS FULL ARGV, and the weaker form is recorded here because it was written first and
        // was worthless: `argv.at(-1) === <flow>.yaml` PASSES on the split, since the stray words land in
        // the middle and the path stays last. Maestro takes the FIRST positional, so the defect is a
        // SURPLUS positional, invisible to any assertion that only inspects the end. Equality over the
        // whole list is the only shape that sees it.
        const port = execFileSync('bash', [SCRIPT, 'driver-port'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();

        expect(maestroArgv()).toEqual([
            'test',
            ...manifestToEnvLines(manifest).flatMap((pair) => ['-e', pair]),
            '--driver-host-port',
            port,
            'packages/apps/commise/mobile/.maestro/recipes/discover-clone.yaml',
        ]);
    });

    it('⛔ logs the driver port, so the next failure names it without an artifact download', () => {
        // The single highest-value diagnostic: answering "which port did this flow use?" required
        // downloading and unzipping the run artifact. It belongs in the CI log.
        expect(stdout).toMatch(/driver port/i);
    });
});
