/**
 * `bin/mac/androidLaneHost.sh`: what runs ON the Mac for an Android lane (ADR-0088 §5): check the SDK, make the lane AVD,
 * reap an earlier run's emulators, boot, install, stop.
 *
 * Each case runs the REAL script in `bash` with fake `adb`, `avdmanager` and `emulator` first on `PATH` and a fake SDK tree
 * under a temp `HOME`. Nothing here boots an emulator.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../mac/androidLaneHost.sh', import.meta.url));
const IMAGE = 'system-images;android-34;google_apis;arm64-v8a';

interface Rig {
    readonly home: string;
    readonly bin: string;
    readonly calls: string;
    readonly avdHome: string;
    readonly sdk: string;
}

const spawned: number[] = [];

afterEach(() => {
    for (const pid of spawned.splice(0)) {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            // already gone
        }
    }
});

/** A temp HOME with a fake SDK tree and fake tools that append their argv to one log. */
function makeRig(options: { withImage?: boolean } = {}): Rig {
    const home = mkdtempSync(path.join(tmpdir(), 'androidLaneHost-'));
    const bin = path.join(home, 'bin');
    const calls = path.join(home, 'calls.log');
    const sdk = path.join(home, 'ksAndroid/sdk');
    const avdHome = path.join(home, 'ksAndroid/avd');
    mkdirSync(bin, { recursive: true });
    mkdirSync(avdHome, { recursive: true });
    writeFileSync(calls, '');

    for (const dir of ['emulator', 'platform-tools', 'cmdline-tools/latest/bin']) {
        mkdirSync(path.join(sdk, dir), { recursive: true });
    }

    if (options.withImage !== false) {
        mkdirSync(path.join(sdk, 'system-images/android-34/google_apis/arm64-v8a'), { recursive: true });
    }

    const tool = (name: string, body: string): void => {
        writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\necho "${name} $*" >> "${calls}"\n${body}\n`);
        chmodSync(path.join(bin, name), 0o755);
    };

    tool('adb', 'exit 0');
    tool('emulator', 'exit 0');
    // avdmanager makes the AVD folder the way the real one does: a config.ini with a few lines.
    tool(
        'avdmanager',
        `name=""; while [ $# -gt 0 ]; do [ "$1" = -n ] && name="$2"; shift; done\n` +
            `mkdir -p "${avdHome}/$name.avd"; printf 'hw.lcd.width=1080\\nhw.ramSize=2048\\n' > "${avdHome}/$name.avd/config.ini"`,
    );
    writeFileSync(path.join(home, 'ksAndroid/env.sh'), '');

    return { home, bin, calls, avdHome, sdk };
}

function host(rig: Rig, args: readonly string[], env: Readonly<Record<string, string>> = {}) {
    return spawnSync('bash', [SCRIPT, ...args], {
        encoding: 'utf8',
        env: {
            PATH: `${rig.bin}:/usr/bin:/bin`,
            HOME: rig.home,
            ANDROID_HOME: rig.sdk,
            ANDROID_SDK_ROOT: rig.sdk,
            ANDROID_AVD_HOME: rig.avdHome,
            KS_ANDROID_ENV: path.join(rig.home, 'ksAndroid/env.sh'),
            ...env,
        },
    });
}

const logged = (rig: Rig): string => readFileSync(rig.calls, 'utf8');

/** The fake emulator runs in the background, so its log line lands a moment after `boot` returns. */
async function emulatorLine(rig: Rig): Promise<string> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const line = logged(rig)
            .split('\n')
            .find((l) => l.startsWith('emulator '));

        if (line !== undefined) {
            return line;
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return '';
}

const config = (rig: Rig, name: string): string =>
    readFileSync(path.join(rig.avdHome, `${name}.avd/config.ini`), 'utf8');

describe('the Android environment file', () => {
    it('is refused by name when it is stated and missing: a lane would run on whatever SDK the shell happens to have', () => {
        const result = host(makeRig(), ['doctor', IMAGE], { KS_ANDROID_ENV: '/nonexistent/env.sh' });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('KS_ANDROID_ENV');
        expect(result.stderr).toContain('/nonexistent/env.sh');
    });

    it("is optional: with none stated the script uses the caller's environment", () => {
        const rig = makeRig();
        const result = spawnSync('bash', [SCRIPT, 'doctor', IMAGE], {
            encoding: 'utf8',
            env: { PATH: `${rig.bin}:/usr/bin:/bin`, HOME: rig.home, ANDROID_HOME: rig.sdk },
        });

        expect(result.status, result.stderr).toBe(0);
    });
});

describe('doctor', () => {
    it('passes when the SDK holds the tools and the system image', () => {
        expect(host(makeRig(), ['doctor', IMAGE]).status).toBe(0);
    });

    it('names the system image it cannot find', () => {
        const result = host(makeRig({ withImage: false }), ['doctor', IMAGE]);

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(IMAGE);
    });

    it('refuses an image name that is not a plain sdkmanager path', () => {
        expect(host(makeRig(), ['doctor', 'x; touch pwned']).status).not.toBe(0);
    });
});

describe('ensure-avd', () => {
    it('accepts the x86_64 image too: WSL builds its AVD with the same script, and the ABI has an underscore', () => {
        const rig = makeRig();
        const result = host(rig, [
            'ensure-avd',
            'ks_lane_lean',
            'system-images;android-34;google_apis;x86_64',
            'hw.cpu.ncore=2',
        ]);

        expect(result.status, result.stderr).toBe(0);
        expect(logged(rig)).toContain('-k system-images;android-34;google_apis;x86_64');
    });

    it('creates the AVD, then writes the given settings over avdmanager defaults', () => {
        const rig = makeRig();
        const result = host(rig, ['ensure-avd', 'ks_lane_lean', IMAGE, 'hw.lcd.width=720', 'hw.cpu.ncore=2']);

        expect(result.status, result.stderr).toBe(0);
        expect(logged(rig)).toContain(`avdmanager create avd -n ks_lane_lean -k ${IMAGE}`);
        const text = config(rig, 'ks_lane_lean');
        expect(text).toContain('hw.lcd.width=720');
        expect(text).not.toContain('hw.lcd.width=1080');
        expect(text).toContain('hw.cpu.ncore=2');
        expect(text).toContain('hw.ramSize=2048');
    });

    it('is idempotent: a second call creates nothing and leaves one line per setting', () => {
        const rig = makeRig();
        host(rig, ['ensure-avd', 'ks_lane_lean', IMAGE, 'hw.lcd.width=720']);
        host(rig, ['ensure-avd', 'ks_lane_lean', IMAGE, 'hw.lcd.width=720']);

        expect(logged(rig).match(/avdmanager create/gu)).toHaveLength(1);
        expect(config(rig, 'ks_lane_lean').match(/^hw\.lcd\.width=/gmu)).toHaveLength(1);
    });

    it.each(['hw.ramSize=1536M; touch pwned', 'hw ramSize=1', '=1', 'hw.x=$(id)'])(
        'refuses the setting %j',
        (setting) => {
            const rig = makeRig();
            const result = host(rig, ['ensure-avd', 'ks_lane_lean', IMAGE, setting]);

            expect(result.status).not.toBe(0);
            expect(logged(rig)).not.toContain('avdmanager');
        },
    );

    it('refuses an AVD name with a space or metacharacter', () => {
        expect(host(makeRig(), ['ensure-avd', 'a b', IMAGE]).status).not.toBe(0);
    });
});

describe('boot and stop', () => {
    it('boots a cold, read-only, windowless emulator on the given even port and records its pid file', async () => {
        const rig = makeRig();
        const result = host(rig, ['boot', 'ks_lane_lean', '5560']);

        expect(result.status, result.stderr).toBe(0);
        const line = await emulatorLine(rig);
        expect(line).toContain('-avd ks_lane_lean');
        expect(line).toContain('-port 5560');

        for (const flag of ['-no-window', '-no-snapshot', '-read-only', '-no-audio', '-no-boot-anim']) {
            expect(line).toContain(flag);
        }

        expect(existsSync(path.join(rig.home, 'ksAndroid/lanes/emulator-5560.pid'))).toBe(true);
    });

    it('uses the host GPU by default: measured 3.6 times less cpu than swiftshader_indirect for the same UI work', async () => {
        const rig = makeRig();
        host(rig, ['boot', 'ks_lane_lean', '5560']);

        expect(await emulatorLine(rig)).toContain('-gpu host');
        expect(await emulatorLine(rig)).not.toContain('swiftshader');
    });

    it('takes the GPU mode from KS_ANDROID_GPU, so the choice is measured and not baked in', async () => {
        const rig = makeRig();
        spawnSync('bash', [SCRIPT, 'boot', 'ks_lane_lean', '5560'], {
            encoding: 'utf8',
            env: {
                PATH: `${rig.bin}:/usr/bin:/bin`,
                HOME: rig.home,
                KS_ANDROID_ENV: path.join(rig.home, 'ksAndroid/env.sh'),
                KS_ANDROID_GPU: 'host',
            },
        });

        expect(await emulatorLine(rig)).toContain('-gpu host');
    });

    it.each(['5555', '5553', '9000', 'abc', '5560; id'])('refuses the emulator port %j', (port) => {
        const rig = makeRig();

        expect(host(rig, ['boot', 'ks_lane_lean', port]).status).not.toBe(0);
        expect(logged(rig)).not.toContain('emulator ');
    });

    it('stop asks the emulator to quit, and removes the pid file', () => {
        const rig = makeRig();
        host(rig, ['boot', 'ks_lane_lean', '5562']);
        const result = host(rig, ['stop', '5562']);

        expect(result.status, result.stderr).toBe(0);
        expect(logged(rig)).toContain('adb -s emulator-5562 emu kill');
        expect(existsSync(path.join(rig.home, 'ksAndroid/lanes/emulator-5562.pid'))).toBe(false);
    });
});

describe('reap', () => {
    /** A process whose command line looks like a lane emulator's, reparented to init so a zombie never looks alive. */
    function fakeEmulator(avd: string, port: string): { pid: number } {
        const result = spawnSync(
            'bash',
            [
                '-c',
                `(exec -a "qemu-system-aarch64 -avd ${avd} -port ${port}" sleep 300 </dev/null >/dev/null 2>&1 &) ; sleep 0.2; pgrep -f "qemu-system-aarch64 -avd ${avd} -port ${port}"`,
            ],
            { encoding: 'utf8' },
        );
        const pid = Number(result.stdout.trim().split('\n')[0]);
        spawned.push(pid);

        return { pid };
    }

    const alive = (pid: number | undefined): boolean => {
        try {
            process.kill(pid ?? -1, 0);

            return true;
        } catch {
            return false;
        }
    };

    it('kills a recorded emulator of the lane AVD and removes its pid file', async () => {
        const rig = makeRig();
        const child = fakeEmulator('ks_lane_lean', '5564');
        mkdirSync(path.join(rig.home, 'ksAndroid/lanes'), { recursive: true });
        writeFileSync(path.join(rig.home, 'ksAndroid/lanes/emulator-5564.pid'), `${String(child.pid)}\n`);

        const result = host(rig, ['reap', 'ks_lane_lean']);

        expect(result.status, result.stderr).toBe(0);
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(alive(child.pid)).toBe(false);
        expect(existsSync(path.join(rig.home, 'ksAndroid/lanes/emulator-5564.pid'))).toBe(false);
    });

    it('never kills a process that merely reuses a recorded pid: it must be an emulator of this AVD', async () => {
        const rig = makeRig();
        const other = fakeEmulator('someone_elses_avd', '5566');
        mkdirSync(path.join(rig.home, 'ksAndroid/lanes'), { recursive: true });
        writeFileSync(path.join(rig.home, 'ksAndroid/lanes/emulator-5566.pid'), `${String(other.pid)}\n`);

        host(rig, ['reap', 'ks_lane_lean']);

        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(alive(other.pid)).toBe(true);
        expect(existsSync(path.join(rig.home, 'ksAndroid/lanes/emulator-5566.pid'))).toBe(false);
    });

    it('succeeds with nothing to reap', () => {
        expect(host(makeRig(), ['reap', 'ks_lane_lean']).status).toBe(0);
    });
});

describe('install', () => {
    it('installs an APK on the named emulator', () => {
        const rig = makeRig();
        const result = host(rig, ['install', 'emulator-5560', '/x/app.apk']);

        expect(result.status, result.stderr).toBe(0);
        expect(logged(rig)).toContain('adb -s emulator-5560 install -r -t /x/app.apk');
    });

    it('has no reverse command: the runner reverses the ports itself, through the adb shim', () => {
        const rig = makeRig();

        expect(host(rig, ['reverse', 'emulator-5560', '3000:3000']).status).not.toBe(0);
        expect(logged(rig)).not.toContain('reverse');
    });

    it.each(['emulator-5560; id', 'device', 'emulator-55'])('refuses the serial %j', (serial) => {
        const rig = makeRig();

        expect(host(rig, ['install', serial, '/x/app.apk']).status).not.toBe(0);
        expect(logged(rig)).not.toContain('install');
    });
});
