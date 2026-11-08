/**
 * `bin/mac/adbShim.sh` and the Android part of `bin/mac/maestroShim.sh`: the WSL runner's `adb` and `maestro` run on the
 * Mac, where the emulators are (ADR-0088 §5). Each case runs the REAL script with a fake `ssh` that records its own words
 * and runs the remote command string in a local `bash`, so the quoting is exercised for real, against a fake `adb` and
 * `maestro` that print what they received.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MAC_DIR = fileURLToPath(new URL('../mac/', import.meta.url));

interface Rig {
    readonly root: string;
    readonly bin: string;
    readonly log: string;
}

function makeRig(): Rig {
    const root = mkdtempSync(path.join(tmpdir(), 'androidShims-'));
    const bin = path.join(root, 'bin');
    const log = path.join(root, 'out.log');
    mkdirSync(bin);
    mkdirSync(path.join(root, 'tree/mobile'), { recursive: true });
    writeFileSync(path.join(root, 'android.env'), '');

    const tool = (name: string, body: string): void => {
        writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
        chmodSync(path.join(bin, name), 0o755);
    };

    // ssh [-F cfg] [-tt] host command: record the words before the command, then run the command in a local bash
    tool('ssh', `printf 'SSH %s\\n' "\${*:1:$#-1}" >> "${log}"\nexec bash -c "\${@: -1}"`);

    for (const name of ['adb', 'maestro']) {
        tool(
            name,
            `{ echo "TOOL ${name}"; printf 'ARG %s\\n' "$@"; echo "SERIAL \${ANDROID_SERIAL:-unset}"; ` +
                `echo "ANDROID_HOME \${ANDROID_HOME:-unset}"; echo "PATH0 \${PATH%%:*}"; } >> "${log}"`,
        );
    }

    return { root, bin, log };
}

function run(rig: Rig, script: string, args: readonly string[], env: Record<string, string> = {}) {
    return spawnSync('bash', [path.join(MAC_DIR, script), ...args], {
        encoding: 'utf8',
        env: {
            PATH: `${rig.bin}:/usr/bin:/bin`,
            HOME: rig.root,
            KS_MAC_HOST: 'mac.example',
            KS_MAC_SSH_CONFIG: path.join(rig.root, 'ssh.conf'),
            KS_MAC_ANDROID_ENV: path.join(rig.root, 'android.env'),
            ...env,
        },
    });
}

const lines = (rig: Rig, prefix: string): string[] =>
    readFileSync(rig.log, 'utf8')
        .split('\n')
        .filter((l) => l.startsWith(prefix))
        .map((l) => l.slice(prefix.length));

describe('adbShim.sh', () => {
    it('forwards every argument to adb on the Mac, spaces and quotes intact', () => {
        const rig = makeRig();
        const result = run(rig, 'adbShim.sh', ['shell', 'echo', "a b'c;d"], { ANDROID_SERIAL: 'emulator-5560' });

        expect(result.status, result.stderr).toBe(0);
        expect(lines(rig, 'ARG ')).toEqual(['shell', 'echo', "a b'c;d"]);
    });

    it('carries the lane serial as a remote environment variable, never as -s', () => {
        const rig = makeRig();
        run(rig, 'adbShim.sh', ['devices'], { ANDROID_SERIAL: 'emulator-5560' });

        expect(lines(rig, 'SERIAL ')).toEqual(['emulator-5560']);
        expect(lines(rig, 'ARG ')).not.toContain('-s');
    });

    it('refuses a serial that is not an emulator serial, because it is written into a remote command', () => {
        const rig = makeRig();
        const result = run(rig, 'adbShim.sh', ['devices'], { ANDROID_SERIAL: 'emulator-5560; id' });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('ANDROID_SERIAL');
    });

    it('allocates a terminal ONLY for a streaming logcat, so killing the reader hangs up the Mac process', () => {
        const rig = makeRig();
        run(rig, 'adbShim.sh', ['logcat', '-v', 'time'], { ANDROID_SERIAL: 'emulator-5560' });
        run(rig, 'adbShim.sh', ['logcat', '-d'], { ANDROID_SERIAL: 'emulator-5560' });
        run(rig, 'adbShim.sh', ['shell', 'getprop', 'x'], { ANDROID_SERIAL: 'emulator-5560' });
        run(rig, 'adbShim.sh', ['logcat', '-c'], { ANDROID_SERIAL: 'emulator-5560' });
        const ssh = lines(rig, 'SSH ');

        expect(ssh[0]).toContain('-tt');
        expect(ssh.slice(1).some((l) => l.includes('-tt'))).toBe(false);
    });

    it('passes the remote exit code back', () => {
        const rig = makeRig();
        writeFileSync(path.join(rig.bin, 'adb'), '#!/usr/bin/env bash\nexit 7\n');

        expect(run(rig, 'adbShim.sh', ['shell', 'false'], { ANDROID_SERIAL: 'emulator-5560' }).status).toBe(7);
    });

    it('refuses to guess the host', () => {
        const rig = makeRig();

        expect(run(rig, 'adbShim.sh', ['devices'], { KS_MAC_HOST: '' }).status).not.toBe(0);
    });
});

describe('maestroShim.sh with KS_MAC_ANDROID_HOME', () => {
    const base = (rig: Rig, extra: Record<string, string> = {}) => ({
        KS_MAC_TREE: path.join(rig.root, 'tree'),
        KS_MAC_LANE_HOME: path.join(rig.root, 'home1'),
        KS_MAC_JAVA_HOME: '/Users/x/jdk',
        KS_MAC_MAESTRO_BIN: path.join(rig.bin, 'maestro'),
        ...extra,
    });

    it('gives Maestro on the Mac the Android SDK, so it finds adb', () => {
        const rig = makeRig();
        const result = run(
            rig,
            'maestroShim.sh',
            ['test', '.maestro/x.yaml'],
            base(rig, { KS_MAC_ANDROID_HOME: '/Users/x/sdk' }),
        );

        expect(result.status, result.stderr).toBe(0);
        expect(lines(rig, 'ANDROID_HOME ')).toEqual(['/Users/x/sdk']);
        expect(lines(rig, 'PATH0 ')).toEqual(['/Users/x/sdk/platform-tools']);
    });

    it('leaves the Mac environment alone when it is not set (the iOS lane)', () => {
        const rig = makeRig();
        run(rig, 'maestroShim.sh', ['test', '.maestro/x.yaml'], base(rig));

        expect(lines(rig, 'ANDROID_HOME ')).toEqual(['unset']);
    });

    it('refuses an SDK path with a quote or a space, because it is written into the remote command', () => {
        const rig = makeRig();
        const result = run(rig, 'maestroShim.sh', ['test', 'x.yaml'], base(rig, { KS_MAC_ANDROID_HOME: "/x'; id; '" }));

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('KS_MAC_ANDROID_HOME');
    });
});
