/**
 * The Mac side of an iOS lane: `bin/mac/{maestroShim,xcrunShim,laneHost}.sh`.
 *
 * The shims stand in for `maestro` and `xcrun` on the WSL runner and run the real tool on the Mac over ssh. Each case
 * runs the REAL script with a fake `ssh` first on `PATH`. The fake runs the remote command string in a local `bash`,
 * so the shell quoting the shim built is exercised for real: a value with spaces survives only if it was escaped.
 * Nothing here touches a Mac, a network or a Simulator.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { IOS_DEVICES, laneSimulatorName } from '../../src/maestroLanes/iosLane.js';
import { macPathsOf } from '../../src/maestroLanes/macSession.js';

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
    function withSimulators(
        sandbox: Sandbox,
        devices: readonly { name: string; udid: string; deviceTypeIdentifier?: string }[],
    ): void {
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
                `if [ "$2" = create ]; then printf 'XCRUN %s\\n' "$*" >> "${sandbox.log}"; echo NEW-UDID; exit 0; fi\n` +
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

    it('prints the UDID of an existing lane Simulator and creates nothing', () => {
        const sandbox = makeSandbox();
        withSimulators(sandbox, [{ name: 'ks-maestro-lane-2', udid: 'AAAA' }]);
        const found = run('laneHost.sh', ['udid', '2'], sandbox);
        expect(found.stdout.trim()).toBe('AAAA');
        const missing = run('laneHost.sh', ['udid', '3'], sandbox);
        expect(missing.status).toBe(0);
        expect(missing.stdout.trim()).toBe('');
    });

    it('creates the lane Simulator when none carries the name', () => {
        const sandbox = makeSandbox();
        withSimulators(sandbox, [{ name: 'ks-maestro-lane-1', udid: 'AAAA' }]);
        const result = run('laneHost.sh', ['ensure', '3'], sandbox);
        expect(result.stdout.trim()).toBe('NEW-UDID');
    });

    const callsOf = (sandbox: Sandbox): string[] =>
        (existsSync(sandbox.log) ? readFileSync(sandbox.log, 'utf8') : '')
            .split('\n')
            .filter((l) => l.startsWith('XCRUN'));
    const RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5';

    it('reuses an iPad lane Simulator by its own name, never the iPhone lane of the same number', () => {
        const sandbox = makeSandbox();
        withSimulators(sandbox, [
            { name: 'ks-maestro-lane-2', udid: 'PHONE' },
            { name: 'ks-maestro-ipad-2', udid: 'PAD' },
        ]);
        expect(run('laneHost.sh', ['ensure', '2', 'ipad'], sandbox).stdout.trim()).toBe('PAD');
        expect(run('laneHost.sh', ['ensure', '2', 'iphone'], sandbox).stdout.trim()).toBe('PHONE');
        expect(run('laneHost.sh', ['ensure', '2'], sandbox).stdout.trim()).toBe('PHONE');
    });

    it('creates an iPad lane from the iPad device type, and an iPhone lane from the iPhone one', () => {
        const sandbox = makeSandbox();
        withSimulators(sandbox, []);
        const env = { KS_SIM_IPAD_DEVICE_TYPE: 'type.pad', KS_SIM_DEVICE_TYPE: 'type.phone' };
        run('laneHost.sh', ['ensure', '3', 'ipad'], sandbox, env);
        run('laneHost.sh', ['ensure', '3'], sandbox, env);
        expect(callsOf(sandbox)).toEqual([
            `XCRUN simctl create ks-maestro-ipad-3 type.pad ${RUNTIME}`,
            `XCRUN simctl create ks-maestro-lane-3 type.phone ${RUNTIME}`,
        ]);
    });

    it('defaults the iPad device type to the 820 pt iPad Air 11-inch (M3) and the iPhone to the iPhone 17', () => {
        const sandbox = makeSandbox();
        withSimulators(sandbox, []);
        run('laneHost.sh', ['ensure', '1', 'ipad'], sandbox);
        run('laneHost.sh', ['ensure', '1'], sandbox);
        expect(callsOf(sandbox)).toEqual([
            `XCRUN simctl create ks-maestro-ipad-1 com.apple.CoreSimulator.SimDeviceType.iPad-Air-11-inch-M3 ${RUNTIME}`,
            `XCRUN simctl create ks-maestro-lane-1 com.apple.CoreSimulator.SimDeviceType.iPhone-17 ${RUNTIME}`,
        ]);
    });

    it('names a created lane exactly as the TypeScript does, for every device class', () => {
        for (const device of IOS_DEVICES) {
            const sandbox = makeSandbox();
            withSimulators(sandbox, []);
            run('laneHost.sh', ['ensure', '3', device], sandbox);
            const [created] = callsOf(sandbox);
            expect(created?.split(' ')[3]).toBe(laneSimulatorName(3, device));
        }
    });

    it('deletes and recreates a lane Simulator whose device type is not the one asked for now', () => {
        const sandbox = makeSandbox();
        withSimulators(sandbox, [{ name: 'ks-maestro-ipad-2', udid: 'OLD', deviceTypeIdentifier: 'type.old' }]);
        const result = run('laneHost.sh', ['ensure', '2', 'ipad'], sandbox, { KS_SIM_IPAD_DEVICE_TYPE: 'type.new' });
        expect(result.stdout.trim()).toBe('NEW-UDID');
        expect(callsOf(sandbox)).toEqual([
            'XCRUN simctl shutdown OLD',
            'XCRUN simctl delete OLD',
            `XCRUN simctl create ks-maestro-ipad-2 type.new ${RUNTIME}`,
        ]);
    });

    it('keeps a lane Simulator whose device type is the one asked for', () => {
        const sandbox = makeSandbox();
        withSimulators(sandbox, [{ name: 'ks-maestro-ipad-2', udid: 'PAD', deviceTypeIdentifier: 'type.same' }]);
        const result = run('laneHost.sh', ['ensure', '2', 'ipad'], sandbox, { KS_SIM_IPAD_DEVICE_TYPE: 'type.same' });
        expect(result.stdout.trim()).toBe('PAD');
        expect(callsOf(sandbox)).toEqual([]);
    });

    it('judges the first Simulator of a name by its own device type, never by a later one of the same name', () => {
        const sandbox = makeSandbox();
        // The first match states no type (nothing to compare, so it is kept); the second states an old one. The udid
        // and the type must come from the SAME record, or the first would be deleted for the second's type.
        withSimulators(sandbox, [
            { name: 'ks-maestro-ipad-2', udid: 'FIRST' },
            { name: 'ks-maestro-ipad-2', udid: 'SECOND', deviceTypeIdentifier: 'type.old' },
        ]);
        const result = run('laneHost.sh', ['ensure', '2', 'ipad'], sandbox, { KS_SIM_IPAD_DEVICE_TYPE: 'type.new' });
        expect(result.stdout.trim()).toBe('FIRST');
        expect(callsOf(sandbox)).toEqual([]);
    });

    it('refuses a device class that is not iphone or ipad, and shell text in one', () => {
        const sandbox = makeSandbox();
        withSimulators(sandbox, []);
        expect(run('laneHost.sh', ['ensure', '1', 'ipod'], sandbox).status).not.toBe(0);
        expect(run('laneHost.sh', ['ensure', '1', ''], sandbox).status).not.toBe(0);
        expect(run('laneHost.sh', ['udid', '1', 'x;rm'], sandbox).status).not.toBe(0);
        expect(callsOf(sandbox)).toEqual([]);
    });

    it('prints the iPad UDID only for an iPad udid lookup, and nothing when only the iPhone lane exists', () => {
        const sandbox = makeSandbox();
        withSimulators(sandbox, [
            { name: 'ks-maestro-lane-2', udid: 'PHONE' },
            { name: 'ks-maestro-ipad-2', udid: 'PAD' },
            { name: 'ks-maestro-lane-3', udid: 'PHONE3' },
        ]);
        expect(run('laneHost.sh', ['udid', '2', 'ipad'], sandbox).stdout.trim()).toBe('PAD');
        expect(run('laneHost.sh', ['udid', '3', 'ipad'], sandbox).stdout.trim()).toBe('');
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

    it('installs the one .app bundle found in the directory', () => {
        const sandbox = makeSandbox();
        withSimulators(sandbox, []);
        mkdirSync(path.join(sandbox.root, 'apps', 'Commise.app'), { recursive: true });
        run('laneHost.sh', ['install', 'AAAA', path.join(sandbox.root, 'apps')], sandbox);
        expect(readFileSync(sandbox.log, 'utf8')).toContain(
            `XCRUN simctl install AAAA ${path.join(sandbox.root, 'apps', 'Commise.app')}`,
        );
    });

    it('refuses to install when the directory holds no .app', () => {
        const sandbox = makeSandbox();
        withSimulators(sandbox, []);
        mkdirSync(path.join(sandbox.root, 'empty'));
        expect(run('laneHost.sh', ['install', 'AAAA', path.join(sandbox.root, 'empty')], sandbox).status).not.toBe(0);
    });

    it('removes the lane Simulators of every device class on cleanup, never another one', () => {
        const sandbox = makeSandbox();
        // One lane per class, named by the same function the planner uses, so a class added to IOS_DEVICES is covered.
        const lanes = IOS_DEVICES.map((device, index) => ({
            name: laneSimulatorName(1, device),
            udid: `LANE${String(index)}`,
        }));
        withSimulators(sandbox, [
            ...lanes,
            { name: 'ksS1Lane1', udid: 'BBBB' },
            { name: 'ks-maestro-lane-x', udid: 'CCCC' },
            { name: 'ks-maestro-ipad-', udid: 'DDDD' },
        ]);
        run('laneHost.sh', ['cleanup'], sandbox);
        const log = readFileSync(sandbox.log, 'utf8');

        for (const lane of lanes) {
            expect(log).toContain(`XCRUN simctl delete ${lane.udid}`);
        }

        for (const kept of ['BBBB', 'CCCC', 'DDDD']) {
            expect(log).not.toContain(kept);
        }
    });
});

describe('buildIosApp.sh check', () => {
    const KEY = 'abc123';
    const PUBLISHABLE = 'pk_test_FAKEPUBLISHABLE';
    /** The folder TypeScript states (`macPathsOf().iosApp(key)`): the script builds none. */
    const APP = macPathsOf().iosApp(KEY);
    const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

    function manifestFor(overrides: Record<string, string> = {}): string {
        const fields: Record<string, string> = {
            platform: 'ios',
            contentKey: KEY,
            recipeOrigin: 'http://localhost:13000',
            foodOrigin: 'http://localhost:13002',
            identityOrigin: 'http://localhost:13001',
            publishableKeySha256: sha256(PUBLISHABLE),
            xcodeVersion: 'Xcode 27.2 Build version 27B52',
            builtFromSha: 'deadbeef',
            builtInRun: 'local',
            ...overrides,
        };

        return `${Object.entries(fields)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n')}\n`;
    }

    /** A fake ssh that serves `manifest` for the `cat` of the app's manifest (or fails when there is none). */
    function withMacHolding(sandbox: Sandbox, manifest: string | undefined) {
        const served = path.join(sandbox.root, 'served.manifest');

        if (manifest !== undefined) {
            writeFileSync(served, manifest);
        }

        const file = path.join(sandbox.bin, 'ssh');
        writeFileSync(
            file,
            `#!/usr/bin/env bash\ncmd="\${@: -1}"\ncase "$cmd" in\n` +
                `  cat\\ ksIos/apps/*) cat "${served}" ;;\n` +
                `  *xcodebuild*) printf 'Xcode 27.2\\nBuild version 27B52\\n' ;;\n  *) exit 9 ;;\nesac\n`,
        );
        chmodSync(file, 0o755);
    }

    const check = (sandbox: Sandbox) =>
        run('buildIosApp.sh', ['check', KEY, APP], sandbox, {
            CLERK_PUBLISHABLE_KEY: PUBLISHABLE,
            KS_REPO_ROOT: fileURLToPath(new URL('../../../../../', import.meta.url)),
            PATH: `${sandbox.bin}:/usr/bin:/bin:/usr/local/bin`,
        });

    it('accepts an app whose manifest matches the tree, loopback origins and Xcode exactly', () => {
        const sandbox = makeSandbox();
        withMacHolding(sandbox, manifestFor());
        expect(check(sandbox).status).toBe(0);
    });

    it('refuses an app built against the shared 3000 origin', () => {
        const sandbox = makeSandbox();
        withMacHolding(sandbox, manifestFor({ recipeOrigin: 'http://localhost:3000' }));
        const result = check(sandbox);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('recipeOrigin');
    });

    it('refuses an app built from another content key', () => {
        const sandbox = makeSandbox();
        withMacHolding(sandbox, manifestFor({ contentKey: 'ffff' }));
        expect(check(sandbox).status).not.toBe(0);
    });

    it('refuses an app built by another Xcode', () => {
        const sandbox = makeSandbox();
        withMacHolding(sandbox, manifestFor({ xcodeVersion: 'Xcode 26.5 Build version 1' }));
        expect(check(sandbox).status).not.toBe(0);
    });

    it('says how to build it when the Mac holds no app for the key', () => {
        const sandbox = makeSandbox();
        withMacHolding(sandbox, undefined);
        rmSync(path.join(sandbox.root, 'served.manifest'), { force: true });
        const result = check(sandbox);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(`build ${KEY}`);
    });

    it('reads the manifest from the folder it is given, not from a path of its own', () => {
        const sandbox = makeSandbox();
        withMacHolding(sandbox, manifestFor());
        const seen = path.join(sandbox.root, 'ssh.seen');
        const file = path.join(sandbox.bin, 'ssh');
        writeFileSync(
            file,
            `#!/usr/bin/env bash\ncmd="\${@: -1}"\necho "$cmd" >> "${seen}"\ncase "$cmd" in\n` +
                `  cat\\ elsewhere/*) cat "${path.join(sandbox.root, 'served.manifest')}" ;;\n` +
                `  *xcodebuild*) printf 'Xcode 27.2\\nBuild version 27B52\\n' ;;\n  *) exit 9 ;;\nesac\n`,
        );
        chmodSync(file, 0o755);

        const result = run('buildIosApp.sh', ['check', KEY, `elsewhere/${KEY}`], sandbox, {
            CLERK_PUBLISHABLE_KEY: PUBLISHABLE,
            KS_REPO_ROOT: fileURLToPath(new URL('../../../../../', import.meta.url)),
            PATH: `${sandbox.bin}:/usr/bin:/bin:/usr/local/bin`,
        });

        expect(result.status, result.stderr).toBe(0);
        expect(readFileSync(seen, 'utf8')).toContain(`cat elsewhere/${KEY}/testApp.manifest`);
    });

    it.each(['', 'a b', '../x', '/abs/path', "x';y", 'a/../b'])(
        'refuses the app folder %j, which becomes part of a remote command',
        (folder) => {
            const sandbox = makeSandbox();
            withMacHolding(sandbox, manifestFor());
            const result = run('buildIosApp.sh', ['check', KEY, folder], sandbox, {
                CLERK_PUBLISHABLE_KEY: PUBLISHABLE,
            });

            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain('app folder');
        },
    );

    it('refuses a key that is not lowercase hex, so it cannot reach a remote command', () => {
        const sandbox = makeSandbox();
        withMacHolding(sandbox, manifestFor());
        const result = run('buildIosApp.sh', ['check', 'x; reboot', APP], sandbox, {
            CLERK_PUBLISHABLE_KEY: PUBLISHABLE,
        });
        expect(result.status).not.toBe(0);
    });

    it('refuses a Mac path setting that holds a quote or a semicolon, because it is written into a remote script', () => {
        const sandbox = makeSandbox();
        withMacHolding(sandbox, manifestFor());

        for (const name of ['KS_MAC_DEVELOPER_DIR', 'KS_MAC_PATH']) {
            const result = run('buildIosApp.sh', ['check', KEY, APP], sandbox, {
                CLERK_PUBLISHABLE_KEY: PUBLISHABLE,
                [name]: "/x'; touch pwned; '",
            });
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain(name);
        }
    });

    it('refuses a publishable key with a character that could leave its quotes', () => {
        const sandbox = makeSandbox();
        const result = run('buildIosApp.sh', ['check', KEY, APP], sandbox, { CLERK_PUBLISHABLE_KEY: "pk_test_a'b" });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('CLERK_PUBLISHABLE_KEY');
    });

    it('refuses an ssh config path that rsync would split', () => {
        const sandbox = makeSandbox();
        const result = run('buildIosApp.sh', ['check', KEY, APP], sandbox, {
            CLERK_PUBLISHABLE_KEY: PUBLISHABLE,
            KS_MAC_SSH_CONFIG: '/with space/ssh.conf',
        });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('KS_MAC_SSH_CONFIG');
    });

    it('refuses a live publishable key', () => {
        const sandbox = makeSandbox();
        const result = run('buildIosApp.sh', ['check', KEY, APP], sandbox, { CLERK_PUBLISHABLE_KEY: 'pk_live_x' });
        expect(result.status).not.toBe(0);
    });
});
