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
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { consumableSlots } from '@kitchensink/e2e-fixtures/testPool';
import { deriveFixtureManifest, manifestToEnvLines } from '@kitchensink/e2e-seed';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** What `provision` decides at run time: the leased erasure subject and the verified remote probe words. */
const provisioned = (erasureEmail: string | null): Parameters<typeof manifestToEnvLines>[1] => ({
    erasureEmail,
    probeWords: {
        appendWord: 'paneer',
        appendFood: 'paneer run',
        changeWord: 'gochujang',
        unresolvedWord: 'halloumi',
        noMatchFood: 'Maestro Zorbleflax',
    },
});

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh');

/** Every stubbed command appends `<name>\t<arg>\t<arg>…` here, in invocation order. */
let calls: string[] = [];
let stdout = '';
/** The consumable pool slot `provision` would lease for the erasure flow — the first one, as on a fresh pool. */
const ERASURE_SUBJECT = consumableSlots('maestro')[0]?.email ?? '';
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

/** The stub tree this file built — `undefined` if `beforeAll` died before creating it. */
let workdir: string | undefined;

afterAll(() => {
    if (workdir !== undefined) {
        rmSync(workdir, { recursive: true, force: true });
    }
});

beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'maestro-lifecycle-'));

    workdir = dir;
    const log = join(dir, 'calls.log');

    writeFileSync(log, '', 'utf8');

    for (const name of ['adb', 'maestro', 'node', 'npx']) {
        stub(dir, name, log);
    }

    // The manifest the loop threads into every flow, from the REAL producer — a hand-written fixture could
    // drift into values with no spaces, which is the one shape that cannot reproduce the defect.
    // Shard 1 — the unsharded tier. This suite exercises the per-flow lifecycle, not the partition
    // (`maestroShardPartition.test.ts` owns that), so it drives the `run-one` seam with one shard's identities.
    manifest = deriveFixtureManifest(RUN_KEY, 'android', 1);
    const manifestFile = join(dir, 'fixture.env');

    writeFileSync(manifestFile, `${manifestToEnvLines(manifest, provisioned(ERASURE_SUBJECT)).join('\n')}\n`, 'utf8');

    // Run ONE flow through the real loop. `run-one` keeps the harness honest: the loop under test is the
    // same one CI runs, not a reimplementation.
    const result = spawnSync('bash', [SCRIPT, 'run-one', 'recipes/discoverDetailSaveCopy'], {
        cwd: REPO_ROOT, // where CI runs it: the script names the flows and the seed door by repository path
        encoding: 'utf8',
        env: {
            ...process.env,
            PATH: `${dir}:${process.env['PATH'] ?? ''}`,
            // Empty is unset to `runCli.sh`: a caller's bundle directory must not route the resets away from the `npx` stub.
            E2E_SEED_CLI_DIR: '',
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
        const expected = manifestToEnvLines(manifest, provisioned(ERASURE_SUBJECT)).flatMap((pair) => ['-e', pair]);

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
            ...manifestToEnvLines(manifest, provisioned(ERASURE_SUBJECT)).flatMap((pair) => ['-e', pair]),
            '-e',
            'APP_ID=io.commise.mobile', // Android: the package, not the iOS bundle (maestroAppId.test.ts)
            '--driver-host-port',
            port,
            'packages/apps/commise/mobile/.maestro/recipes/discoverDetailSaveCopy.yaml',
        ]);
    });

    it('⛔ logs the driver port, so the next failure names it without an artifact download', () => {
        // The single highest-value diagnostic: answering "which port did this flow use?" required
        // downloading and unzipping the run artifact. It belongs in the CI log.
        expect(stdout).toMatch(/driver port/i);
    });
});

/**
 * ⛔ A FAILED SEED RESET STOPS THE SHARD; A FAILED FLOW DOES NOT.
 *
 * A reset that fails is the ENVIRONMENT failing — the stage, identity, Clerk or the pool slot — not the flow it was
 * about to run, and the next flow's reset meets the same cause. One run proved it: the pool signers had no roles, every
 * reset answered `400 INVALID_VISIBILITY`, and the shard reported one red per flow for one missing `poolAdmin
 * --apply`. So the loop stops at the FIRST reset failure and names the flows it did not run. A flow that fails after
 * a good reset is that flow's own result, and every later flow still runs.
 *
 * Both directions are asserted, because either alone is satisfied by the wrong loop: "stops at a reset failure" by a
 * loop that stops at every failure, and "keeps going after a flow failure" by the loop this replaces.
 */
describe('maestro flow loop — the first failed reset stops the shard, a failed flow does not', () => {
    const FLOWS = ['recipes/collections', 'recipes/accessibility', 'recipes/addStepFocus'] as const;

    /**
     * Run the real loop over {@link FLOWS} with `failing` stubbed to exit 1 and every other tool to exit 0.
     *
     * @sideEffect Writes stubs and a manifest to a temp directory, spawns bash, removes the directory.
     */
    function runWith(failing: 'npx' | 'maestro'): { calls: string[]; output: string; status: number } {
        const dir = mkdtempSync(join(tmpdir(), `maestro-${failing}-fails-`));

        try {
            const log = join(dir, 'calls.log');

            writeFileSync(log, '', 'utf8');

            for (const name of ['adb', 'maestro', 'node', 'npx']) {
                stub(dir, name, log);
            }

            // The failing tool records its call like the others, then exits 1.
            writeFileSync(
                join(dir, failing),
                `#!/usr/bin/env bash\n{ printf '%s' "${failing}"; printf '\\t%s' "$@"; printf '\\n'; } >> "${log}"\nexit 1\n`,
                'utf8',
            );
            chmodSync(join(dir, failing), 0o755);

            const manifestFile = join(dir, 'fixture.env');

            writeFileSync(
                manifestFile,
                `${manifestToEnvLines(deriveFixtureManifest(RUN_KEY, 'android', 1), provisioned(ERASURE_SUBJECT)).join('\n')}\n`,
                'utf8',
            );

            const result = spawnSync('bash', [SCRIPT, 'run-one', ...FLOWS], {
                cwd: REPO_ROOT, // where CI runs it: the script names the flows and the seed door by repository path
                encoding: 'utf8',
                env: {
                    ...process.env,
                    PATH: `${dir}:${process.env['PATH'] ?? ''}`,
                    // Empty is unset to `runCli.sh`: a caller's bundle directory must not route the resets away from the `npx` stub.
                    E2E_SEED_CLI_DIR: '',
                    MAESTRO_FIXTURE_ENV_FILE: manifestFile,
                },
            });

            return {
                calls: readFileSync(log, 'utf8')
                    .split('\n')
                    .filter((line) => line.trim().length > 0),
                output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
                status: result.status ?? -1,
            };
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }

    const resets = (calls: readonly string[]) => calls.filter((call) => /^npx\t.*e2e-seed\/src\/reset\.ts/u.test(call));
    const flowRuns = (calls: readonly string[]) => calls.filter((call) => /^maestro\t.*\btest\b/u.test(call));

    describe('when the first reset fails', () => {
        let run: ReturnType<typeof runWith>;

        beforeAll(() => {
            run = runWith('npx');
        }, 60_000);

        it('reached the loop at all (non-vacuity: the device check ran)', () => {
            expect(
                run.calls.some((call) => call.startsWith('adb')),
                run.output,
            ).toBe(true);
        });

        it('⛔ resets once, drives no flow, and fails the shard', () => {
            expect(resets(run.calls), run.output).toHaveLength(1);
            expect(flowRuns(run.calls)).toStrictEqual([]);
            expect(run.status).not.toBe(0);
        });

        it('says the shard stopped, and names every flow it did not run', () => {
            expect(run.output).toMatch(/::error::e2e-seed reset failed before recipes\/collections/u);
            expect(run.output).toMatch(/::error::.*stopping this shard/u);

            for (const flow of FLOWS) {
                expect(run.output).toContain(flow);
            }
        });
    });

    describe('when every flow fails after a good reset', () => {
        let run: ReturnType<typeof runWith>;

        beforeAll(() => {
            run = runWith('maestro');
        }, 60_000);

        it('⛔ still resets for, and drives, every flow', () => {
            expect(resets(run.calls), run.output).toHaveLength(FLOWS.length);
            expect(flowRuns(run.calls)).toHaveLength(FLOWS.length);
        });

        it('reports each flow failure, and fails the shard', () => {
            for (const flow of FLOWS) {
                expect(run.output).toContain(`FLOW FAILED: ${flow}`);
            }

            expect(run.output).not.toMatch(/stopping this shard/u);
            expect(run.status).not.toBe(0);
        });
    });
});

/**
 * ⛔ THE LOOP REFUSES AN ERASING FLOW WHEN THE MANIFEST NAMES NO SUBJECT — before the reset, and before Maestro.
 *
 * Only the erasure shard leases a subject (`maestroErasureSlots`, testPool.ts), so every other shard's manifest is
 * written with `manifestToEnvLines(manifest, provisioned(null))` and omits `E2E_ERASURE_EMAIL`. `maestroShardPartition.test.ts`
 * executes the decision; this proves the REAL loop applies it: no `npx` (the per-flow reset) and no `maestro` call is
 * recorded, the loop exits non-zero, and it says why.
 */
describe('maestro flow loop — an erasing flow with no leased subject is never driven', () => {
    let refusedCalls: string[] = [];
    let refusedOutput = '';
    let refusedStatus = -1;
    let refusedDir: string | undefined;

    afterAll(() => {
        if (refusedDir !== undefined) {
            rmSync(refusedDir, { recursive: true, force: true });
        }
    });

    beforeAll(() => {
        const dir = mkdtempSync(join(tmpdir(), 'maestro-erasure-refusal-'));

        refusedDir = dir;
        const log = join(dir, 'calls.log');

        writeFileSync(log, '', 'utf8');

        for (const name of ['adb', 'maestro', 'node', 'npx']) {
            stub(dir, name, log);
        }

        // Shard 2's manifest, from the REAL producer: it leased no erasure subject.
        const manifestFile = join(dir, 'fixture.env');

        writeFileSync(
            manifestFile,
            `${manifestToEnvLines(deriveFixtureManifest(RUN_KEY, 'android', 2), provisioned(null)).join('\n')}\n`,
            'utf8',
        );

        const result = spawnSync('bash', [SCRIPT, 'run-one', 'accountErasure'], {
            cwd: REPO_ROOT, // where CI runs it: the script names the flows and the seed door by repository path
            encoding: 'utf8',
            env: {
                ...process.env,
                PATH: `${dir}:${process.env['PATH'] ?? ''}`,
                // Empty is unset to `runCli.sh`: a caller's bundle directory must not route the resets away from the `npx` stub.
                E2E_SEED_CLI_DIR: '',
                MAESTRO_FIXTURE_ENV_FILE: manifestFile,
            },
        });

        refusedOutput = `${result.stdout ?? ''}${result.stderr ?? ''}`;
        refusedStatus = result.status ?? -1;
        refusedCalls = readFileSync(log, 'utf8')
            .split('\n')
            .filter((line) => line.trim().length > 0);
    }, 60_000);

    it('reached the loop at all (non-vacuity: the device check ran)', () => {
        expect(
            refusedCalls.some((call) => call.startsWith('adb')),
            refusedOutput,
        ).toBe(true);
    });

    it('⛔ never resets for it and never hands it to maestro', () => {
        expect(refusedCalls.filter((call) => /^(npx|maestro)\t/u.test(call))).toStrictEqual([]);
    });

    it('fails the run, and says why', () => {
        expect(refusedStatus).not.toBe(0);
        expect(refusedOutput).toMatch(/::error::accountErasure ERASES a pool slot/u);
    });
});

/**
 * ⛔ AN iOS DRIVER THAT NEVER STARTED IS RETRIED ONCE; NOTHING ELSE IS.
 *
 * CI run 39376194588, iOS shard 4: the first flow (`auth/loginFlow`) died with Maestro's
 * `xcuitest.installer.LocalXCTestInstaller$IOSDriverTimeoutException: iOS driver not ready in time` after 5.7 minutes,
 * before ANY flow step ran, while every later flow passed. That red says nothing about the app, so the loop resets the
 * driver and runs the SAME flow once more (no reseed: the first attempt ran no step). Four directions are held, because
 * each alone is satisfied by the wrong loop: "retries on the timeout" by a loop that retries every failure, "runs once on
 * an assertion failure" by a loop that never retries, and the Android row by a loop that forgets the platform.
 */
describe('maestro flow loop — a driver that never started is retried once, on iOS only', () => {
    const FLOW = 'auth/loginFlow';
    const TIMEOUT_TEXT =
        'xcuitest.installer.LocalXCTestInstaller$IOSDriverTimeoutException: iOS driver not ready in time\n';
    const ASSERTION_TEXT = 'Assertion is false: "Welcome" is visible\n';

    /**
     * Run the real loop over {@link FLOW} with a `maestro` stub whose Nth call prints and exits as `attempts[N-1]`
     * (the last entry repeats).
     *
     * @sideEffect Writes stubs to a temp directory, spawns bash, removes the directory.
     */
    function runFlow(
        platform: 'ios' | 'android',
        attempts: readonly { readonly text: string; readonly exit: number }[],
    ): { calls: string[]; output: string; status: number } {
        const dir = mkdtempSync(join(tmpdir(), 'maestro-driver-retry-'));

        try {
            const log = join(dir, 'calls.log');

            writeFileSync(log, '', 'utf8');

            for (const name of ['adb', 'node', 'npx', 'xcrun']) {
                stub(dir, name, log);
            }

            // One script per attempt, picked by a counter file: bash 3.2 compatible and easy to read in a failure.
            attempts.forEach((attempt, index) => {
                writeFileSync(join(dir, `attempt${index + 1}.txt`), attempt.text, 'utf8');
            });
            const last = attempts.length;

            writeFileSync(
                join(dir, 'maestro'),
                [
                    '#!/usr/bin/env bash',
                    `{ printf '%s' maestro; printf '\\t%s' "$@"; printf '\\n'; } >> "${log}"`,
                    `counter="${dir}/count"`,
                    'n=$(( $(cat "$counter" 2>/dev/null || echo 0) + 1 ))',
                    'echo "$n" > "$counter"',
                    `[ "$n" -gt ${last} ] && n=${last}`,
                    `cat "${dir}/attempt\${n}.txt" >&2`,
                    `case "$n" in ${attempts.map((a, i) => `${i + 1}) exit ${a.exit} ;;`).join(' ')} esac`,
                    '',
                ].join('\n'),
                'utf8',
            );
            chmodSync(join(dir, 'maestro'), 0o755);

            const manifestFile = join(dir, 'fixture.env');

            writeFileSync(
                manifestFile,
                `${manifestToEnvLines(deriveFixtureManifest(RUN_KEY, platform, 1), provisioned(null)).join('\n')}\n`,
                'utf8',
            );

            const result = spawnSync('bash', [SCRIPT, 'run-one', FLOW], {
                cwd: REPO_ROOT,
                encoding: 'utf8',
                env: {
                    ...process.env,
                    PATH: `${dir}:${process.env['PATH'] ?? ''}`,
                    E2E_SEED_CLI_DIR: '',
                    MAESTRO_FIXTURE_ENV_FILE: manifestFile,
                    MAESTRO_PLATFORM: platform,
                    MAESTRO_IOS_UDID: 'TEST-UDID',
                },
            });

            return {
                calls: readFileSync(log, 'utf8')
                    .split('\n')
                    .filter((line) => line.trim().length > 0),
                output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
                status: result.status ?? -1,
            };
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }

    const flowRuns = (calls: readonly string[]) => calls.filter((call) => /^maestro\t.*\btest\b/u.test(call));
    const seedResets = (calls: readonly string[]) =>
        calls.filter((call) => /^npx\t.*e2e-seed\/src\/reset\.ts/u.test(call));
    const driverUninstalls = (calls: readonly string[]) =>
        calls.filter((call) => /^xcrun\tsimctl\tuninstall/u.test(call));

    describe('iOS, the driver times out once and then the flow passes', () => {
        let run: ReturnType<typeof runFlow>;

        beforeAll(() => {
            run = runFlow('ios', [
                { text: TIMEOUT_TEXT, exit: 1 },
                { text: '', exit: 0 },
            ]);
        }, 60_000);

        it('⛔ runs the flow twice, the second time with a freshly reset driver, and passes the shard', () => {
            const runs = flowRuns(run.calls);

            expect(runs, run.output).toHaveLength(2);
            expect(runs[0]).not.toContain('--no-reinstall-driver');
            expect(runs[1]).not.toContain('--no-reinstall-driver');
            expect(runs[1]).toBe(runs[0]);
            // Reset before the first attempt AND before the retry.
            expect(driverUninstalls(run.calls), run.output).toHaveLength(2);
            expect(run.status, run.output).toBe(0);
            expect(run.output).not.toContain(`FLOW FAILED: ${FLOW}`);
        });

        it('⛔ does not reseed for the retry — the first attempt ran no step', () => {
            expect(seedResets(run.calls)).toHaveLength(1);
        });

        it('warns, naming the flow and that no step ran', () => {
            expect(run.output).toMatch(new RegExp(`::warning::.*${FLOW}.*driver.*never started.*no step`, 'u'));
        });
    });

    describe('iOS, the driver times out on both attempts', () => {
        let run: ReturnType<typeof runFlow>;

        beforeAll(() => {
            run = runFlow('ios', [{ text: TIMEOUT_TEXT, exit: 1 }]);
        }, 60_000);

        it('⛔ retries ONCE only, then reports FLOW FAILED and fails the shard', () => {
            expect(flowRuns(run.calls), run.output).toHaveLength(2);
            expect(run.output).toContain(`FLOW FAILED: ${FLOW}`);
            expect(run.status).not.toBe(0);
        });
    });

    describe('iOS, an ordinary assertion failure', () => {
        let run: ReturnType<typeof runFlow>;

        beforeAll(() => {
            run = runFlow('ios', [
                { text: ASSERTION_TEXT, exit: 1 },
                { text: '', exit: 0 },
            ]);
        }, 60_000);

        it('⛔ is never retried', () => {
            expect(flowRuns(run.calls), run.output).toHaveLength(1);
            expect(run.output).toContain(`FLOW FAILED: ${FLOW}`);
            expect(run.output).not.toContain('::warning::');
            expect(run.status).not.toBe(0);
        });
    });

    describe('Android, with the driver text in the output', () => {
        let run: ReturnType<typeof runFlow>;

        beforeAll(() => {
            run = runFlow('android', [
                { text: TIMEOUT_TEXT, exit: 1 },
                { text: '', exit: 0 },
            ]);
        }, 60_000);

        it('⛔ is never retried', () => {
            expect(flowRuns(run.calls), run.output).toHaveLength(1);
            expect(run.output).toContain(`FLOW FAILED: ${FLOW}`);
            expect(run.status).not.toBe(0);
        });
    });
});
