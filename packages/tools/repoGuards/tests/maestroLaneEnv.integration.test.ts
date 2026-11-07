/**
 * The runner's LANE contract: the environment a local lane orchestrator sets on run mode, executed as real `bash` with
 * `adb`, `maestro`, `node` and `npx` replaced by recording stubs on `PATH`. Nothing here touches a device or a network.
 *
 * | Variable                          | What run mode must do with it                                                  |
 * | --------------------------------- | ------------------------------------------------------------------------------ |
 * | `ANDROID_SERIAL`                  | `adb` reads it natively; `maestro` is handed `--device <serial>` before `test` |
 * | `MAESTRO_LOCAL=1`                 | drop the sandbox-only flows BEFORE packing, name them, reverse 3000-3002       |
 * | `MAESTRO_LOCAL_RECIPE_HOST_PORT`  | the host side of the device's :3000 when something else holds the host's 3000  |
 * | `MAESTRO_LOCK_DIR`                | run every role flow under `flock <dir>/roles.lock`                              |
 * | `MAESTRO_SKIP_INSTALL=1`          | do not install the app; the device adapter already did                         |
 *
 * And the negative half, which is CI's posture: with none of them set, run mode is what it always was.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh');

/** The lane variables, removed from the inherited environment so a developer's shell cannot leak one into a case. */
const LANE_VARS = [
    'ANDROID_SERIAL',
    'MAESTRO_LOCAL',
    'MAESTRO_LOCAL_RECIPE_HOST_PORT',
    'MAESTRO_LOCK_DIR',
    'MAESTRO_SKIP_INSTALL',
    'MAESTRO_PLATFORM',
    'MAESTRO_SHARD_INDEX',
    'MAESTRO_SHARD_COUNT',
    'MAESTRO_SANDBOX_STOPPED',
] as const;

const scratch: string[] = [];

afterAll(() => {
    for (const dir of scratch) {
        rmSync(dir, { recursive: true, force: true });
    }
});

interface Run {
    /** Each stubbed call as its argv fields; `maestro` calls end with a `lock=held|free` field. */
    readonly calls: readonly (readonly string[])[];
    readonly output: string;
    readonly status: number;
}

/**
 * Run mode once, with stubs that record one field per argument.
 *
 * The `maestro` stub also records whether `<MAESTRO_LOCK_DIR>/roles.lock` is held at the moment it runs, by trying a
 * non-blocking lock of its own on a fresh open of the file: it fails exactly when the runner holds the lock.
 *
 * @sideEffect Writes a scratch directory and spawns `bash`.
 */
function runMode(env: Readonly<Record<string, string>>): Run {
    const dir = mkdtempSync(join(tmpdir(), 'maestro-lane-env-'));
    scratch.push(dir);
    const log = join(dir, 'calls.log');
    writeFileSync(log, '', 'utf8');

    const record = (name: string, extra = ''): string =>
        `#!/usr/bin/env bash\n${extra}{ printf '%s' "${name}"; printf '\\t%s' "$@"; ${
            name === 'maestro' ? `printf '\\tlock=%s' "$lock"; ` : ''
        }printf '\\n'; } >> "${log}"\nexit 0\n`;
    const lockProbe =
        'lock=free\nif [ -n "${MAESTRO_LOCK_DIR:-}" ] && ! flock -n "${MAESTRO_LOCK_DIR}/roles.lock" true; then lock=held; fi\n';

    for (const name of ['adb', 'node', 'npx']) {
        writeFileSync(join(dir, name), record(name), 'utf8');
        chmodSync(join(dir, name), 0o755);
    }

    writeFileSync(join(dir, 'maestro'), record('maestro', lockProbe), 'utf8');
    chmodSync(join(dir, 'maestro'), 0o755);

    const manifest = join(dir, 'fixture.env');
    writeFileSync(manifest, 'E2E_SIGNIN_EMAIL=test-local-signer02+clerk_test@radcile.com\n', 'utf8');

    const inherited: Record<string, string | undefined> = { ...process.env };

    for (const name of LANE_VARS) {
        delete inherited[name];
    }

    const result = spawnSync('bash', [SCRIPT], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: {
            ...inherited,
            PATH: `${dir}:${process.env['PATH'] ?? ''}`,
            E2E_SEED_CLI_DIR: '',
            MAESTRO_FIXTURE_ENV_FILE: manifest,
            ...env,
        },
    });

    return {
        calls: readFileSync(log, 'utf8')
            .split('\n')
            .filter((line) => line.length > 0)
            .map((line) => line.split('\t')),
        output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
        status: result.status ?? -1,
    };
}

const SELECTOR = 'flow:recipes/edit=true flow:recipes/paidFeaturesByRole=true';

/** The flow each `maestro test` call ran, with the lock state it saw. */
const flowsRun = (run: Run): readonly (readonly [string, string])[] =>
    run.calls
        .filter((call) => call[0] === 'maestro')
        .map((call) => {
            const path = call.find((field) => field.endsWith('.yaml')) ?? '';

            return [path.replace(/^.*\/\.maestro\//u, '').replace(/\.yaml$/u, ''), call.at(-1) ?? ''] as const;
        });

describe('run mode under a local lane', () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'maestro-lane-locks-'));
    scratch.push(lockDir);
    const lane = runMode({
        MAESTRO_FLOW_SELECTOR: SELECTOR,
        ANDROID_SERIAL: 'emulator-5558',
        MAESTRO_LOCAL: '1',
        MAESTRO_LOCAL_RECIPE_HOST_PORT: '3100',
        MAESTRO_LOCK_DIR: lockDir,
        MAESTRO_SKIP_INSTALL: '1',
    });

    it('runs the selected flows and passes (the harness is not vacuous)', () => {
        expect(lane.status, lane.output).toBe(0);
        expect(flowsRun(lane).map(([flow]) => flow)).toEqual(['recipes/edit', 'recipes/paidFeaturesByRole']);
    });

    it('hands maestro the lane device before the subcommand, on every call', () => {
        const maestro = lane.calls.filter((call) => call[0] === 'maestro');

        expect(maestro.length).toBeGreaterThan(0);

        for (const call of maestro) {
            expect(call.slice(1, 4)).toEqual(['--device', 'emulator-5558', 'test']);
        }
    });

    it('drops the sandbox-only spine before packing, and says so', () => {
        expect(flowsRun(lane).map(([flow]) => flow)).not.toContain('auth/loginFlow');
        expect(lane.output).toMatch(/not run locally: needs sandbox - auth\/loginFlow/u);
    });

    it('reverses the three service ports, recipe onto its host port', () => {
        const reverses = lane.calls
            .filter((call) => call[0] === 'adb' && call[1] === 'reverse')
            .map((call) => call.slice(2));

        expect(reverses).toEqual([
            ['tcp:3000', 'tcp:3100'],
            ['tcp:3001', 'tcp:3001'],
            ['tcp:3002', 'tcp:3002'],
        ]);
    });

    it('installs nothing', () => {
        expect(lane.calls.filter((call) => call[0] === 'adb' && call[1] === 'install')).toEqual([]);
    });

    it('holds the role lock for a role flow, and only for a role flow', () => {
        expect(flowsRun(lane)).toEqual([
            ['recipes/edit', 'lock=free'],
            ['recipes/paidFeaturesByRole', 'lock=held'],
        ]);
    });
});

describe('run mode with no lane variables (CI)', () => {
    const ci = runMode({ MAESTRO_FLOW_SELECTOR: SELECTOR });

    it('runs the spine and the selected flows, with no lock', () => {
        expect(ci.status, ci.output).toBe(0);
        expect(flowsRun(ci)).toEqual([
            ['auth/loginFlow', 'lock=free'],
            ['recipes/edit', 'lock=free'],
            ['recipes/paidFeaturesByRole', 'lock=free'],
        ]);
    });

    it('names no device, so the argv is what it always was', () => {
        for (const call of ci.calls.filter((entry) => entry[0] === 'maestro')) {
            expect(call[1]).toBe('test');
        }
    });

    it('installs the app and reverses only the recipe port', () => {
        expect(ci.calls.filter((call) => call[0] === 'adb' && call[1] === 'install').length).toBe(1);
        expect(
            ci.calls.filter((call) => call[0] === 'adb' && call[1] === 'reverse').map((call) => call.slice(2)),
        ).toEqual([['tcp:3000', 'tcp:3000']]);
    });
});

describe('shard-selection under MAESTRO_LOCAL', () => {
    const select = (env: Readonly<Record<string, string>>, index: number, count: number): string =>
        spawnSync('bash', [SCRIPT, 'shard-selection', String(index), String(count), 'full=true'], {
            encoding: 'utf8',
            env: { ...process.env, MAESTRO_PLATFORM: 'android', ...env },
        }).stdout ?? '';
    const valuesOf = (out: string, key: string): readonly string[] =>
        out.split('\n').flatMap((line) => (line.startsWith(`${key}=`) ? [line.slice(key.length + 1)] : []));
    const sandboxOnly = (spawnSync('bash', [SCRIPT, 'sandbox-only'], { encoding: 'utf8' }).stdout ?? '')
        .split('\n')
        .filter(Boolean)
        .map((row) => row.split('|')[0] ?? '');

    it('names every sandbox-only flow as needs-sandbox and runs none of them', () => {
        const out = select({ MAESTRO_LOCAL: '1' }, 1, 1);

        expect(valuesOf(out, 'needs-sandbox').map((row) => row.split('|')[0])).toEqual(sandboxOnly);

        for (const flow of sandboxOnly) {
            expect(valuesOf(out, 'flow')).not.toContain(flow);
        }
    });

    it.each([2, 3, 4])('packs %i lanes over exactly the local selection, each flow once', (count) => {
        const local = valuesOf(select({ MAESTRO_LOCAL: '1' }, 1, 1), 'flow');
        const lanes = Array.from({ length: count }, (_, index) =>
            valuesOf(select({ MAESTRO_LOCAL: '1' }, index + 1, count), 'flow'),
        );
        const union = lanes.flat();

        expect(union.length).toBe(new Set(union).size);
        expect([...union].sort()).toEqual([...local].sort());

        for (const flows of lanes) {
            expect(flows.length).toBeGreaterThan(0);
        }
    });

    it('leaves the deployed composition untouched when MAESTRO_LOCAL is unset', () => {
        const out = select({ MAESTRO_LOCAL: '' }, 1, 1);

        expect(valuesOf(out, 'needs-sandbox')).toEqual([]);
        expect(valuesOf(out, 'flow')).toEqual(expect.arrayContaining(sandboxOnly));
    });
});
