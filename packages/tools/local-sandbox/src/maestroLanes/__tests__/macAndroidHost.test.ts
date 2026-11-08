import { describe, expect, it } from 'vitest';

import { createMacAndroidHost } from '../macAndroidHost.js';
import type { MacShell } from '../macSession.js';
import type { LaneSpec } from '../laneTypes.js';

const WSL_CONFIG = `avd.name = ks_lane_lean
hw.lcd.width = 999
hw.lcd.height = 1777
hw.lcd.density = 333
hw.cpu.ncore = 3
hw.ramSize = 1111M
disk.dataPartition.size = 123456
sdcard.size = 512 MB
vm.heapSize = 228M
hw.gps = yes
`;
const MANIFEST = [
    'platform=android',
    'recipeOrigin=http://localhost:3000',
    'identityOrigin=http://localhost:3001',
    'foodOrigin=http://localhost:3002',
].join('\n');
const SETTINGS = {
    recipeOrigin: 'http://localhost:3000',
    identityOrigin: 'http://localhost:3001',
    foodOrigin: 'http://localhost:3002',
};
const lane: LaneSpec = {
    platform: 'android',
    index: 1,
    count: 1,
    device: 'emulator-5556',
    driverPort: 7001,
    stateDir: '/state/lanes/android-1',
    fixtureEnvFile: '/state/lanes/android-1/fixture.env',
};

interface Rig {
    readonly host: ReturnType<typeof createMacAndroidHost>;
    readonly lines: string[];
    readonly tunnels: string[][];
    readonly links: [string, string][];
    stopped: () => number;
}

function rig(options: { config?: string | undefined; failing?: string } = {}): Rig {
    const lines: string[] = [];
    const tunnels: string[][] = [];
    const links: [string, string][] = [];
    let stopped = 0;
    const shell: MacShell = {
        run: (command, args) => {
            const line = [command, ...args].join(' ');
            lines.push(line);

            if (options.failing !== undefined && line.includes(options.failing)) {
                return Promise.reject(new Error('exit 1'));
            }

            return Promise.resolve(line.includes('printenv HOME') ? '/Users/x\n' : '');
        },
        background: (command, args) => {
            tunnels.push([command, ...args]);

            return {
                stop: () => {
                    stopped += 1;

                    return Promise.resolve();
                },
            };
        },
        writeFile: () => Promise.resolve(),
        linkFile: (target, link) => {
            links.push([target, link]);

            return Promise.resolve();
        },
    };
    const host = createMacAndroidHost({
        shell,
        env: { LOCAL_MAESTRO_IOS_HOST: 'me@mac', PATH: '/usr/bin' },
        repoRoot: '/repo',
        settings: SETTINGS,
        avd: 'ks_lane_lean',
        avdSourceConfig: '/wsl/ks_lane_lean.avd/config.ini',
        readFile: (file) =>
            file === '/wsl/ks_lane_lean.avd/config.ini'
                ? 'config' in options
                    ? options.config
                    : WSL_CONFIG
                : file.endsWith('testApp.manifest')
                  ? MANIFEST
                  : undefined,
    });

    return { host, lines, tunnels, links, stopped: () => stopped };
}

const run = { runId: 'r', stateDir: '/s', repoRoot: '/repo' };
const APK = '/repo/packages/apps/commise/mobile/dist-testApp/android/app.apk';

describe('MacAndroidHost', () => {
    it('is arm64-v8a, the ABI of a Mac emulator', () => {
        expect(rig().host.abi).toBe('arm64-v8a');
    });

    it('costs a lane 5.5 cpus and 5.5 GiB until a Mac run measures it', () => {
        expect(rig().host.laneCost).toEqual({ cpus: 5.5, memBytes: 5.5 * 1024 ** 3 });
    });

    it('reaps an earlier run emulators BEFORE it makes anything ready to boot', async () => {
        const { host, lines } = rig();
        await host.prepare(run, APK, 'abc123');
        const at = (needle: string): number => lines.findIndex((l) => l.includes(needle));

        expect(at('androidLaneHost.sh reap ks_lane_lean')).toBeGreaterThanOrEqual(0);
        expect(at('androidLaneHost.sh reap')).toBeLessThan(at('androidLaneHost.sh ensure-avd'));
    });

    it('makes the AVD from the settings in the WSL ks_lane_lean config, never from numbers written here', async () => {
        const { host, lines } = rig();
        await host.prepare(run, APK, 'abc123');
        // shell-quote escapes `;` and spaces with a backslash; compare what the Mac's shell will read
        const ensure = (lines.find((l) => l.includes('androidLaneHost.sh ensure-avd')) ?? '').replace(/\\/gu, '');

        for (const setting of [
            'hw.lcd.width=999',
            'hw.lcd.height=1777',
            'hw.lcd.density=333',
            'hw.cpu.ncore=3',
            'hw.ramSize=1111M',
            'disk.dataPartition.size=123456',
            'vm.heapSize=228M',
        ]) {
            expect(ensure, setting).toContain(setting);
        }

        expect(ensure).not.toContain('hw.gps');
        expect(ensure).toContain('system-images;android-34;google_apis;arm64-v8a');
    });

    it('refuses to prepare when the WSL AVD config it copies from is not there', async () => {
        await expect(rig({ config: undefined }).host.prepare(run, APK, 'abc123')).rejects.toThrow(/ks_lane_lean/);
    });

    it('copies the APK to the Mac under its content key', async () => {
        const { host, lines } = rig();
        await host.prepare(run, APK, 'abc123');
        const scp = lines.filter((l) => l.startsWith('scp') && l.includes('app.apk')).join('\n');

        expect(scp).toContain(APK);
        expect(scp).toContain('me@mac:ksIos/apps/android/abc123/app.apk');
    });

    it('refuses a content key that is not lowercase hex', async () => {
        await expect(rig().host.prepare(run, APK, 'abc;id')).rejects.toThrow(/content key/);
    });

    it('opens one tunnel: the recipe on 13000 (Docker holds the Mac 3000), identity and food on their own ports', async () => {
        const { host, tunnels } = rig();
        await host.prepare(run, APK, 'abc123');
        const tunnel = tunnels[0]?.join(' ') ?? '';

        expect(tunnel).toContain('-R 13000:localhost:3000');
        expect(tunnel).toContain('-R 3001:localhost:3001');
        expect(tunnel).toContain('-R 3002:localhost:3002');
        expect(tunnel).not.toContain('-R 3000:');
    });

    it('puts the maestro and adb shims on the lane PATH', async () => {
        const { host, links } = rig();
        await host.prepare(run, APK, 'abc123');

        expect(links.map(([, link]) => link).sort()).toEqual(['/s/shims/adb', '/s/shims/maestro']);
    });

    it('boots the lane emulator on the console port of its serial, through the lane script', async () => {
        const { host, lines } = rig();
        await host.prepare(run, APK, 'abc123');
        await host.boot(lane);

        expect(lines.some((l) => l.includes('androidLaneHost.sh boot ks_lane_lean 5556'))).toBe(true);
    });

    it('answers a failing adb as an exit code, not an exception, so boot polling can go on', async () => {
        const { host } = rig({ failing: 'get-state' });
        await host.prepare(run, APK, 'abc123');

        await expect(host.adb('emulator-5556', 'get-state')).resolves.toMatchObject({ code: 1 });
    });

    it('quotes every adb word, so a value with a space, quote and semicolon is one argument', async () => {
        const { host, lines } = rig();
        await host.prepare(run, APK, 'abc123');
        await host.adb('emulator-5556', 'shell', "a b'c;d");
        const sent = lines[lines.length - 1] ?? '';

        expect(sent).toContain('adb -s emulator-5556 shell');
        expect(sent).not.toContain("shell a b'c;d");
    });

    it('installs the staged APK, and says whether it worked', async () => {
        const ok = rig();
        await ok.host.prepare(run, APK, 'abc123');
        await expect(ok.host.install(lane)).resolves.toBe(true);
        expect(
            ok.lines.some((l) =>
                l.includes('androidLaneHost.sh install emulator-5556 /Users/x/ksIos/apps/android/abc123/app.apk'),
            ),
        ).toBe(true);

        const bad = rig({ failing: 'androidLaneHost.sh install' });
        await bad.host.prepare(run, APK, 'abc123');
        await expect(bad.host.install(lane)).resolves.toBe(false);
    });

    it('stops an emulator through the lane script, on abort too', async () => {
        const { host, lines } = rig();
        await host.prepare(run, APK, 'abc123');
        await host.stop(lane);
        await host.abort(lane);

        expect(lines.filter((l) => l.includes('androidLaneHost.sh stop 5556'))).toHaveLength(2);
    });

    it('gives the runner the lane device, the Mac SDK, the shims first on PATH and the Mac recipe tunnel port', async () => {
        const { host } = rig();
        await host.prepare(run, APK, 'abc123');
        const env = host.laneEnv(lane);

        expect(env['ANDROID_SERIAL']).toBe('emulator-5556');
        expect(env['MAESTRO_SKIP_INSTALL']).toBe('1');
        expect(env['MAESTRO_LOCAL_RECIPE_HOST_PORT']).toBe('13000');
        expect(env['KS_MAC_ANDROID_HOME']).toBe('/Users/x/ksAndroid/sdk');
        expect(env['KS_MAC_ANDROID_ENV']).toBe('/Users/x/ksAndroid/env.sh');
        expect(env['PATH']?.startsWith('/s/shims:')).toBe(true);
        expect(env['KS_MAC_LANE_HOME']).toBe('/Users/x/ksIos/lanes/lane1');
    });

    it('closes the tunnel on teardown', async () => {
        const { host, stopped } = rig();
        await host.prepare(run, APK, 'abc123');
        await host.teardown();

        expect(stopped()).toBe(1);
    });
});
