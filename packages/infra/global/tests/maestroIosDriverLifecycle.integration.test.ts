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
 *   - The driver is torn down BEFORE the flow (the Android ordering, for the iOS reason: Maestro's iOS start
 *     REUSES a runner already answering on the pinned host port).
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

import { consumableSlots } from '@kitchensink/e2e-fixtures/testPool';
import { deriveFixtureManifest, manifestToEnvLines } from '@kitchensink/e2e-seed';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh');
const UDID = 'AAAAAAAA-1111-2222-3333-444444444444';
const DRIVER_BUNDLE = 'dev.mobile.maestro-driver-iosUITests.xctrunner';
const ERASURE_SUBJECT = consumableSlots('maestro')[0]?.email ?? '';

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

        // ONE field per argument, so a flattened argv is visible.
        writeFileSync(
            path,
            `#!/usr/bin/env bash\n{ printf '%s' "${name}"; printf '\\t%s' "$@"; printf '\\n'; } >> "${log}"\nexit 0\n`,
            'utf8',
        );
        chmodSync(path, 0o755);
    }

    const manifest = deriveFixtureManifest('pr91-ios-lifecycle', 1);
    const manifestFile = join(dir, 'fixture.env');

    writeFileSync(manifestFile, `${manifestToEnvLines(manifest, ERASURE_SUBJECT).join('\n')}\n`, 'utf8');

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
        const manifest = deriveFixtureManifest('pr91-ios-lifecycle', 1);
        const port = execFileSync('bash', [SCRIPT, 'driver-port'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
        const invocation = recorded.calls.find((call) => call.startsWith('maestro\t')) ?? '';

        expect(invocation.split('\t').slice(1)).toEqual([
            '--device',
            UDID,
            'test',
            ...manifestToEnvLines(manifest, ERASURE_SUBJECT).flatMap((pair) => ['-e', pair]),
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
        expect(recorded.calls.filter((call) => /io\.commise|\terase\b|\tprivacy\t/u.test(call))).toEqual([]);
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
