/**
 * The Mac side of an iOS lane: `bin/mac/{maestroShim,xcrunShim,laneHost}.sh`.
 *
 * The shims stand in for `maestro` and `xcrun` on the WSL runner and run the real tool on the Mac over ssh. Each case
 * runs the REAL script with a fake `ssh` first on `PATH`. The fake runs the remote command string in a local `bash`,
 * so the shell quoting the shim built is exercised for real: a value with spaces survives only if it was escaped.
 * Nothing here touches a Mac, a network or a Simulator.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MAC_DIR = fileURLToPath(new URL('../mac/', import.meta.url));

interface Sandbox {
    readonly root: string;
    readonly bin: string;
    readonly log: string;
}

/**
 * A temp directory with a fake `ssh` (runs its last argument in `bash -c`) and a fake `xcrun` and `maestro` that write
 * one argument per line to a log, framed by a marker line.
 *
 * @sideEffect Creates files under the OS temp directory.
 */
function makeSandbox(): Sandbox {
    const root = mkdtempSync(path.join(tmpdir(), 'macShims-'));
    const bin = path.join(root, 'bin');
    const log = path.join(root, 'argv.log');
    mkdirSync(bin);
    mkdirSync(path.join(root, 'tree', 'mobile'), { recursive: true });
    const write = (name: string, body: string): void => {
        const file = path.join(bin, name);
        writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
        chmodSync(file, 0o755);
    };
    // ssh [-F cfg] host command: the command is the last argument; the host and options are recorded as the first line.
    write('ssh', `printf 'SSH %s\\n' "$*" >> "${log}"\nexec bash -c "\${@: -1}"`);
    for (const tool of ['xcrun', 'maestro']) {
        write(tool, `{ echo "TOOL ${tool}"; printf 'ARG %s\\n' "$@"; echo "HOME $HOME"; } >> "${log}"`);
    }
    return { root, bin, log };
}

function run(script: string, args: readonly string[], sandbox: Sandbox, env: Record<string, string> = {}) {
    return spawnSync('bash', [path.join(MAC_DIR, script), ...args], {
        encoding: 'utf8',
        env: {
            PATH: `${sandbox.bin}:/usr/bin:/bin`,
            KS_MAC_HOST: 'mac.example',
            KS_MAC_SSH_CONFIG: path.join(sandbox.root, 'ssh.conf'),
            KS_MAC_TREE: path.join(sandbox.root, 'tree'),
            KS_MAC_LANE_HOME: '/Users/x/ksIos/home1',
            KS_MAC_JAVA_HOME: '/Users/x/jdk',
            KS_MAC_MAESTRO_BIN: path.join(sandbox.bin, 'maestro'),
            ...env,
        },
    });
}

const argvOf = (log: string): string[] =>
    readFileSync(log, 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('ARG '))
        .map((l) => l.slice(4));

describe('xcrunShim.sh', () => {
    it('forwards every argument to the Mac, spaces and quotes intact', () => {
        const sandbox = makeSandbox();
        const result = run('xcrunShim.sh', ['simctl', 'spawn', 'UDID', 'defaults', 'write', 'a b', "it's"], sandbox);
        expect(result.status).toBe(0);
        expect(argvOf(sandbox.log)).toEqual(['simctl', 'spawn', 'UDID', 'defaults', 'write', 'a b', "it's"]);
    });

    it('goes through the lane ssh config to the named host', () => {
        const sandbox = makeSandbox();
        run('xcrunShim.sh', ['simctl', 'list'], sandbox);
        expect(readFileSync(sandbox.log, 'utf8')).toContain(`SSH -F ${sandbox.root}/ssh.conf mac.example`);
    });

    it('passes the remote exit code back', () => {
        const sandbox = makeSandbox();
        writeFileSync(path.join(sandbox.bin, 'xcrun'), '#!/usr/bin/env bash\nexit 7\n');
        expect(run('xcrunShim.sh', ['x'], sandbox).status).toBe(7);
    });

    it('refuses to guess the host', () => {
        const sandbox = makeSandbox();
        const result = run('xcrunShim.sh', ['x'], sandbox, { KS_MAC_HOST: '' });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('KS_MAC_HOST');
    });
});

describe('maestroShim.sh', () => {
    const flow = '/home/me/repo/packages/apps/commise/mobile/.maestro/auth/loginFlow.yaml';

    it('keeps a value with spaces whole and rewrites the flow path to the synced tree', () => {
        const sandbox = makeSandbox();
        const result = run(
            'maestroShim.sh',
            ['test', '-e', 'FIXTURE_NAME=Ada Lovelace', '--driver-host-port', '7001', flow],
            sandbox,
        );
        expect(result.status).toBe(0);
        expect(argvOf(sandbox.log)).toEqual([
            'test',
            '-e',
            'FIXTURE_NAME=Ada Lovelace',
            '--driver-host-port',
            '7001',
            '.maestro/auth/loginFlow.yaml',
        ]);
    });

    it('does not rewrite a -e value that merely contains the folder name', () => {
        const sandbox = makeSandbox();
        run('maestroShim.sh', ['test', '-e', 'X=/a/.maestro/b.yaml', flow], sandbox);
        expect(argvOf(sandbox.log)).toContain('X=/a/.maestro/b.yaml');
    });

    it('runs from the lane home and the synced tree', () => {
        const sandbox = makeSandbox();
        run('maestroShim.sh', ['test', flow], sandbox);
        expect(readFileSync(sandbox.log, 'utf8')).toContain('HOME /Users/x/ksIos/home1');
    });

    it('refuses without a lane home, because a shared home shares one Maestro driver state', () => {
        const sandbox = makeSandbox();
        const result = run('maestroShim.sh', ['test', flow], sandbox, { KS_MAC_LANE_HOME: '' });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('KS_MAC_LANE_HOME');
    });
});

describe('laneHost.sh', () => {
    /** A fake `xcrun` that answers `simctl list -j devices` from a fixture and logs every other call. */
    function withSimulators(sandbox: Sandbox, devices: readonly { name: string; udid: string }[]): void {
        const json = JSON.stringify({
            devices: {
                'com.apple.CoreSimulator.SimRuntime.iOS-26-5': devices.map((d) => ({ ...d, state: 'Shutdown' })),
            },
        });
        const fixture = path.join(sandbox.root, 'devices.json');
        writeFileSync(fixture, json);
        const file = path.join(sandbox.bin, 'xcrun');
        writeFileSync(
            file,
            `#!/usr/bin/env bash\nif [ "$2" = list ]; then cat "${fixture}"; exit 0; fi\n` +
                `if [ "$2" = create ]; then echo NEW-UDID; exit 0; fi\n` +
                `printf 'XCRUN %s\\n' "$*" >> "${sandbox.log}"\n`,
        );
        chmodSync(file, 0o755);
    }

    it('reuses a lane Simulator that already exists, by name', () => {
        const sandbox = makeSandbox();
        withSimulators(sandbox, [{ name: 'ks-maestro-lane-2', udid: 'AAAA' }]);
        const result = run('laneHost.sh', ['ensure', '2'], sandbox);
        expect(result.stdout.trim()).toBe('AAAA');
    });

    it('creates the lane Simulator when none carries the name', () => {
        const sandbox = makeSandbox();
        withSimulators(sandbox, [{ name: 'ks-maestro-lane-1', udid: 'AAAA' }]);
        const result = run('laneHost.sh', ['ensure', '3'], sandbox);
        expect(result.stdout.trim()).toBe('NEW-UDID');
    });

    it('refuses a lane index that is not a positive integer', () => {
        const sandbox = makeSandbox();
        withSimulators(sandbox, []);
        expect(run('laneHost.sh', ['ensure', '0'], sandbox).status).not.toBe(0);
        expect(run('laneHost.sh', ['ensure', 'x; rm -rf /'], sandbox).status).not.toBe(0);
    });

    it('erases a Simulator it shut down first', () => {
        const sandbox = makeSandbox();
        withSimulators(sandbox, []);
        run('laneHost.sh', ['erase', 'AAAA'], sandbox);
        const calls = readFileSync(sandbox.log, 'utf8')
            .split('\n')
            .filter((l) => l.startsWith('XCRUN'));
        expect(calls).toEqual(['XCRUN simctl shutdown AAAA', 'XCRUN simctl erase AAAA']);
    });

    it('removes only lane Simulators on cleanup, never another one', () => {
        const sandbox = makeSandbox();
        withSimulators(sandbox, [
            { name: 'ks-maestro-lane-1', udid: 'AAAA' },
            { name: 'ksS1Lane1', udid: 'BBBB' },
        ]);
        run('laneHost.sh', ['cleanup'], sandbox);
        const log = readFileSync(sandbox.log, 'utf8');
        expect(log).toContain('XCRUN simctl delete AAAA');
        expect(log).not.toContain('BBBB');
    });
});
