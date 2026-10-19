/**
 * The iOS half of the Maestro runner's device lifecycle, driven through the REAL `runMaestroFlows.sh` with
 * every device command stubbed on `PATH` — the sibling of `maestroDriverLifecycle.integration.test.ts`, which
 * pins the Android half and must keep passing unchanged.
 *
 * ## What it proves
 *
 *   - On iOS the runner never calls `adb`. A stray `adb` on a macOS runner is a command-not-found that
 *     `|| true` would swallow, so the only way to see it is to record every call.
 *   - The Simulator is NAMED, never inferred: `maestro --device <UDID> test …`, and the driver reset acts on
 *     that UDID.
 *   - The driver is torn down BEFORE the first flow, and before any flow that follows a flow that did not pass (the
 *     Android ordering, for the iOS reason: Maestro's iOS start REUSES a runner already answering on the pinned host
 *     port). After a flow that PASSED it is kept and `--no-reinstall-driver` is passed (the last describe block).
 *   - Run mode installs the built `.app` before the first flow, prints the flows iOS cannot run, and never
 *     drives one of them.
 *   - The app itself is never uninstalled or the Simulator erased between flows (that would sign every flow out).
 *   - A missing UDID or an unknown platform is a RED with an annotation, before any device command.
 *
 * Mutation evidence: written before the iOS adapters existed — against the pre-platform script every case
 * failed (the run recorded `adb` calls and `maestro test` without `--device`). After implementation, swapping
 * the reset's dispatch arms reds "never calls adb" and "tears the driver down"; dropping `device_args` reds the
 * argv case; removing the exclusion filter from run mode reds "never drives an excluded flow".
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MAESTRO_ERASURE_SHARD, maestroErasureSlots } from '@kitchensink/e2e-fixtures/testPool';
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
const UDID = 'AAAAAAAA-1111-2222-3333-444444444444';
const DRIVER_BUNDLE = 'dev.mobile.maestro-driver-iosUITests.xctrunner';
// An iOS subject: the manifest refuses any other platform's (`manifestToEnvLines`, 2026-10-13).
const ERASURE_SUBJECT = maestroErasureSlots('ios', MAESTRO_ERASURE_SHARD)[0]?.email ?? '';

/** Every directory this file created, removed in `afterAll` so a failing test still cleans up. */
const scratch: string[] = [];

afterAll(() => {
    for (const directory of scratch) {
        rmSync(directory, { recursive: true, force: true });
    }
});

interface Recorded {
    readonly calls: readonly string[];
    readonly output: string;
    readonly status: number;
}

/**
 * Run the script once with `adb`, `maestro`, `npx`, `node` and `xcrun` stubbed to record their argv.
 *
 * @param args - The script's arguments.
 * @param env - Environment overrides on top of the stub `PATH` and the fixture manifest.
 * @sideEffect Creates a scratch directory and spawns bash.
 */
function runWithStubs(args: readonly string[], env: Readonly<Record<string, string>>): Recorded {
    const dir = mkdtempSync(join(tmpdir(), 'maestro-ios-lifecycle-'));

    scratch.push(dir);

    const log = join(dir, 'calls.log');

    writeFileSync(log, '', 'utf8');

    for (const name of ['adb', 'maestro', 'node', 'npx', 'xcrun']) {
        const path = join(dir, name);
        // Test-only failure injection, read from the environment the script is run with: `MAESTRO_STUB_FAIL_FLOWS` names
        // flows whose `maestro test` exits 1, and `MAESTRO_STUB_NPX_FAIL_CALL` makes that numbered `npx` call (the per-flow
        // e2e-seed reset) exit 1. Everything else exits 0, so a case that sets neither behaves exactly as before.
        const injected =
            name === 'maestro'
                ? 'last="${!#}"; for f in ${MAESTRO_STUB_FAIL_FLOWS:-}; do case "$last" in */"$f".yaml) exit 1 ;; esac; done\n'
                : name === 'npx'
                  ? `n=$(($(cat "${log}.npx" 2>/dev/null || echo 0) + 1)); echo "$n" > "${log}.npx"; [ "$n" = "\${MAESTRO_STUB_NPX_FAIL_CALL:-0}" ] && exit 1\n`
                  : '';

        // ONE field per argument, so a flattened argv is visible.
        writeFileSync(
            path,
            `#!/usr/bin/env bash\n{ printf '%s' "${name}"; printf '\\t%s' "$@"; printf '\\n'; } >> "${log}"\n${injected}exit 0\n`,
            'utf8',
        );
        chmodSync(path, 0o755);
    }

    const manifest = deriveFixtureManifest('pr91-ios-lifecycle', 'ios', 1);
    const manifestFile = join(dir, 'fixture.env');

    writeFileSync(manifestFile, `${manifestToEnvLines(manifest, provisioned(ERASURE_SUBJECT)).join('\n')}\n`, 'utf8');

    const app = join(dir, 'Commise.app');

    mkdirSync(app);

    const result = spawnSync('bash', [SCRIPT, ...args], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: {
            ...process.env,
            PATH: `${dir}:${process.env['PATH'] ?? ''}`,
            MAESTRO_FIXTURE_ENV_FILE: manifestFile,
            MAESTRO_IOS_APP: app,
            ...env,
        },
    });

    return {
        calls: existsSync(log)
            ? readFileSync(log, 'utf8')
                  .split('\n')
                  .filter((line) => line.trim().length > 0)
            : [],
        output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
        status: result.status ?? -1,
    };
}

const IOS = { MAESTRO_PLATFORM: 'ios', MAESTRO_IOS_UDID: UDID } as const;

describe('maestro iOS driver lifecycle — one flow through the real loop', () => {
    let recorded: Recorded;

    beforeAll(() => {
        recorded = runWithStubs(['run-one', 'recipes/discoverDetailSaveCopy'], IOS);
    }, 60_000);

    const indexOf = (pattern: RegExp): number => recorded.calls.findIndex((call) => pattern.test(call));

    it('runs the flow at all — the harness is not vacuous', () => {
        expect(recorded.status, recorded.output).toBe(0);
        expect(indexOf(/^maestro\t/u), `no maestro call; output:\n${recorded.output}`).toBeGreaterThan(-1);
    });

    it('⛔ never calls adb on iOS', () => {
        expect(recorded.calls.filter((call) => call.startsWith('adb\t'))).toEqual([]);
    });

    it('⛔ names the Simulator: maestro --device <UDID> test …, and nothing else changes in the argv', () => {
        const manifest = deriveFixtureManifest('pr91-ios-lifecycle', 'ios', 1);
        const port = execFileSync('bash', [SCRIPT, 'driver-port'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
        const invocation = recorded.calls.find((call) => call.startsWith('maestro\t')) ?? '';

        expect(invocation.split('\t').slice(1)).toEqual([
            '--device',
            UDID,
            'test',
            ...manifestToEnvLines(manifest, provisioned(ERASURE_SUBJECT)).flatMap((pair) => ['-e', pair]),
            '-e',
            'APP_ID=com.radicle-co.commise', // the iOS bundle, not the Android package (maestroAppId.test.ts)
            '--driver-host-port',
            port,
            'packages/apps/commise/mobile/.maestro/recipes/discoverDetailSaveCopy.yaml',
        ]);
    });

    it('⛔ tears the iOS driver down on THAT Simulator before the flow, not after', () => {
        const terminate = indexOf(new RegExp(`^xcrun\tsimctl\tterminate\t${UDID}\t${DRIVER_BUNDLE}$`, 'u'));
        const uninstall = indexOf(new RegExp(`^xcrun\tsimctl\tuninstall\t${UDID}\t${DRIVER_BUNDLE}$`, 'u'));
        const test = indexOf(/^maestro\t/u);

        expect(terminate, recorded.calls.join('\n')).toBeGreaterThan(-1);
        expect(uninstall, recorded.calls.join('\n')).toBeGreaterThan(-1);
        expect(Math.max(terminate, uninstall)).toBeLessThan(test);
    });

    it('never uninstalls the app or erases the Simulator — that would sign every later flow out', () => {
        expect(
            recorded.calls.filter(
                (call) => /^xcrun\t/u.test(call) && /io\.commise|com\.radicle-co|\terase\b|\tprivacy\t/u.test(call),
            ),
        ).toEqual([]);
    });
});

/**
 * ADDED 2026-10-13 (plan 2026-10-13-006, cut 2). Maestro's pinned CLI (2.6.1) has `--[no-]reinstall-driver` on `test` ("on
 * iOS, reinstalls xctestrunner driver"), and the script used to uninstall the runner before EVERY flow, so every flow paid
 * Maestro's full install and start (a median of 34.9 s of the 46.8 s before "Running on"). The runner is now kept across flows
 * that follow a flow that PASSED, with `--no-reinstall-driver`; anything else resets it exactly as before.
 *
 * Why "the previous flow passed" is the whole rule: the reset's reason for existing is a runner that outlived a CRASHED flow
 * and is inherited, wedged, by the next one (Maestro's iOS start returns early when a runner already answers on the pinned
 * port). A flow that exited 0 closed its session normally, so the runner it leaves is a healthy one. The first flow of a run,
 * a flow after a failed or skipped one, and every Android flow keep the full reset.
 */
describe('maestro iOS driver reuse - kept only after a flow that passed', () => {
    const TERMINATE_OR_UNINSTALL = new RegExp(
        `^xcrun\tsimctl\t(?:terminate|uninstall)\t${UDID}\t${DRIVER_BUNDLE}$`,
        'u',
    );
    const FLOWS = ['home', 'dataSources', 'recipes/delete'] as const;

    /** Per flow: the `maestro` call that ran it, and the driver teardown calls made since the previous flow's call. */
    function perFlow(recorded: Recorded): readonly { readonly argv: readonly string[]; readonly teardowns: number }[] {
        const result: { argv: readonly string[]; teardowns: number }[] = [];
        let teardowns = 0;

        for (const call of recorded.calls) {
            if (TERMINATE_OR_UNINSTALL.test(call)) {
                teardowns += 1;
            } else if (call.startsWith('maestro\t')) {
                result.push({ argv: call.split('\t').slice(1), teardowns });
                teardowns = 0;
            }
        }

        return result;
    }

    it('⛔ resets the runner before the FIRST flow and does not pass the flag', () => {
        const recorded = runWithStubs(['run-one', ...FLOWS], IOS);
        const [first] = perFlow(recorded);

        expect(recorded.status, recorded.output).toBe(0);
        expect(first?.teardowns, recorded.calls.join('\n')).toBe(2);
        expect(first?.argv).not.toContain('--no-reinstall-driver');
    });

    it('⛔ KEEPS the runner for a flow that follows a pass: no terminate, no uninstall, the flag on `test`', () => {
        const flows = perFlow(runWithStubs(['run-one', ...FLOWS], IOS));

        expect(flows).toHaveLength(3);

        for (const next of flows.slice(1)) {
            expect(next.teardowns).toBe(0);
            expect(next.argv.slice(0, 3)).toEqual(['--device', UDID, 'test']);
            expect(next.argv).toContain('--no-reinstall-driver');
        }
    });

    it('⛔ RESETS the runner for the flow after a FAILED one, with no flag - then trusts it again once a flow passes', () => {
        const recorded = runWithStubs(['run-one', ...FLOWS], { ...IOS, MAESTRO_STUB_FAIL_FLOWS: 'dataSources' });
        const flows = perFlow(recorded);

        expect(recorded.status, 'a failed flow must still fail the run').not.toBe(0);
        expect(flows).toHaveLength(3);
        // dataSources ran on a kept runner (home passed) ...
        expect(flows[1]?.teardowns).toBe(0);
        expect(flows[1]?.argv).toContain('--no-reinstall-driver');
        // ... failed, so recipes/delete gets a fresh runner ...
        expect(flows[2]?.teardowns).toBe(2);
        expect(flows[2]?.argv).not.toContain('--no-reinstall-driver');
    });

    // ⚠️ REWRITTEN, not weakened. This case used to prove that the flow AFTER a flow whose world could not be reset got a
    // fresh runner. That flow no longer runs: a failed reset now stops the shard, because it is the stage failing and the
    // next reset meets the same cause (`runMaestroFlows.sh`, `maestroDriverLifecycle.integration.test.ts`). What is left
    // to prove on iOS is that the stop happens here too, after the flow that passed and before anything else is driven.
    it('⛔ STOPS the shard at a reset that fails mid-run, after the flow that passed and before any other', () => {
        // Call 1 resets home's world, call 2 dataSources's: neither dataSources nor recipes/delete may run.
        const recorded = runWithStubs(['run-one', ...FLOWS], { ...IOS, MAESTRO_STUB_NPX_FAIL_CALL: '2' });
        const flows = perFlow(recorded);

        expect(recorded.status).not.toBe(0);
        expect(flows.map((flow) => flow.argv.at(-1))).toEqual(['packages/apps/commise/mobile/.maestro/home.yaml']);
        expect(recorded.output).toMatch(/stopping this shard\. Not run: dataSources recipes\/delete/u);
    });

    it('says, flow by flow, whether the runner was kept or reset - the CI comparison reads this line', () => {
        const recorded = runWithStubs(['run-one', ...FLOWS], IOS);
        const verdicts = recorded.output.split('\n').filter((line) => /^iOS XCUITest runner: /u.test(line));

        expect(verdicts).toEqual([
            'iOS XCUITest runner: reset (first flow of the run) before home',
            'iOS XCUITest runner: kept (the previous flow passed) before dataSources',
            'iOS XCUITest runner: kept (the previous flow passed) before recipes/delete',
        ]);
    });

    it('⛔ Android is untouched: every flow still uninstalls the driver and no flow gets the flag', () => {
        const recorded = runWithStubs(['run-one', 'home', 'dataSources'], { MAESTRO_PLATFORM: 'android' });
        const uninstalls = recorded.calls.filter((call) => /^adb\tshell\tpm\tuninstall\t/u.test(call));

        expect(recorded.status, recorded.output).toBe(0);
        expect(uninstalls).toHaveLength(4);
        expect(recorded.calls.filter((call) => call.includes('--no-reinstall-driver'))).toEqual([]);
        expect(recorded.output).not.toMatch(/XCUITest runner/u);
    });
});

describe('maestro iOS run mode — install, filter, and say what did not run', () => {
    let recorded: Recorded;

    beforeAll(() => {
        recorded = runWithStubs([], {
            ...IOS,
            MAESTRO_FLOW_SELECTOR: 'discovery=true',
            MAESTRO_SHARD_INDEX: '1',
            MAESTRO_SHARD_COUNT: '1',
        });
    }, 120_000);

    const flowsDriven = (): readonly string[] =>
        recorded.calls
            .filter((call) => call.startsWith('maestro\t'))
            .map((call) => (call.split('\t').at(-1) ?? '').replace(/^.*\.maestro\//u, '').replace(/\.yaml$/u, ''));

    it('installs the built app on the named Simulator before the first flow', () => {
        const install = recorded.calls.findIndex((call) => /^xcrun\tsimctl\tinstall\t/u.test(call));

        expect(recorded.status, recorded.output).toBe(0);
        expect(recorded.calls[install]?.split('\t')[3]).toBe(UDID);
        expect(recorded.calls[install]?.split('\t')[4]).toMatch(/Commise\.app$/u);
        expect(install).toBeLessThan(recorded.calls.findIndex((call) => call.startsWith('maestro\t')));
    });

    it('⛔ never drives a flow iOS cannot run, and annotates each one with its class and reason', () => {
        expect(flowsDriven()).not.toContain('recipes/discoverBrowse');
        expect(flowsDriven()).toContain('auth/loginFlow');
        expect(flowsDriven()).toContain('recipes/discoverDetailSaveCopy');
        expect(recorded.output).toMatch(/::notice::excluded on ios: recipes\/discoverBrowse \[coverage-gap\] — \S/u);
    });

    it('never calls adb in run mode either', () => {
        expect(recorded.calls.filter((call) => call.startsWith('adb\t'))).toEqual([]);
    });
});

describe('maestro iOS refusals — red, annotated, and before any device command', () => {
    it('refuses iOS with no Simulator UDID', () => {
        const recorded = runWithStubs(['run-one', 'home'], { MAESTRO_PLATFORM: 'ios' });

        expect(recorded.status).not.toBe(0);
        expect(recorded.output).toMatch(/::error::.*MAESTRO_IOS_UDID/u);
        expect(recorded.calls.filter((call) => /^(maestro|xcrun|adb)\t/u.test(call))).toEqual([]);
    });

    it('refuses an unknown platform rather than defaulting to android', () => {
        for (const args of [['run-one', 'home'], []]) {
            const recorded = runWithStubs(args, { MAESTRO_PLATFORM: 'windows' });

            expect(recorded.status, `${args.join(' ') || '(run mode)'} accepted windows`).not.toBe(0);
            expect(recorded.output).toMatch(/::error::.*MAESTRO_PLATFORM/u);
            expect(recorded.calls.filter((call) => /^(maestro|xcrun|adb)\t/u.test(call))).toEqual([]);
        }
    });

    it('refuses an iOS run whose .app was never built', () => {
        const recorded = runWithStubs([], { ...IOS, MAESTRO_IOS_APP: '/nonexistent/Commise.app' });

        expect(recorded.status).not.toBe(0);
        expect(recorded.output).toMatch(/::error::MAESTRO_IOS_APP/u);
        expect(recorded.calls.filter((call) => call.startsWith('maestro\t'))).toEqual([]);
    });
});
