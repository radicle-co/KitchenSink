import { describe, expect, it } from 'vitest';

import { APK_PATH, makeLane, makeMacAndroidRig, makeRun, makeSettings } from '../__fixtures__/macAndroidHostRig.js';

const settings = makeSettings();
const lane = makeLane();
const run = makeRun();

describe('MacAndroidHost', () => {
    it('is arm64-v8a, the ABI of a Mac emulator', () => {
        expect(makeMacAndroidRig().host.abi).toBe('arm64-v8a');
    });

    it('costs a lane what the 2026-11-08 two-lane Mac run measured: a 2.7 cpu burst and 5.71 GiB peak resident', () => {
        // maestro:macUsage over 2 lanes and 75 minutes: mean 0.65 to 0.68 cpus, p95 1.2, max 2.5 to 2.7; peak resident
        // 5.47 to 5.71 GiB per lane (the emulator and its Maestro JVM). The figures are rounded up.
        expect(makeMacAndroidRig().host.laneCost).toEqual({ cpus: 3, memBytes: Math.round(5.8 * 1024 ** 3) });
    });

    it('reaps an earlier run emulators BEFORE it makes anything ready to boot', async () => {
        const { host, lines } = makeMacAndroidRig();
        await host.prepare(run, APK_PATH, 'abc123');
        const at = (needle: string): number => lines.findIndex((l) => l.includes(needle));

        expect(at('androidLaneHost.sh reap ks_lane_lean')).toBeGreaterThanOrEqual(0);
        expect(at('androidLaneHost.sh reap')).toBeLessThan(at('androidLaneHost.sh ensure-avd'));
    });

    it('makes the AVD from the settings, never from numbers written here or a config copied from WSL', async () => {
        const { host, lines } = makeMacAndroidRig();
        await host.prepare(run, APK_PATH, 'abc123');
        // shell-quote escapes `;` and spaces with a backslash; compare what the Mac's shell will read
        const ensure = (lines.find((l) => l.includes('androidLaneHost.sh ensure-avd')) ?? '').replace(/\\/gu, '');

        for (const setting of settings.avdConfig) {
            expect(ensure, setting).toContain(setting);
        }

        expect(ensure).toContain('image;from;settings;arm64-v8a');
    });

    it('copies the APK to the Mac under its content key', async () => {
        const { host, lines } = makeMacAndroidRig();
        await host.prepare(run, APK_PATH, 'abc123');
        const scp = lines.filter((l) => l.startsWith('scp') && l.includes('app.apk')).join('\n');

        expect(scp).toContain(APK_PATH);
        expect(scp).toContain('me@mac:ksIos/apps/android/abc123/app.apk');
    });

    it('refuses a content key that is not lowercase hex', async () => {
        await expect(makeMacAndroidRig().host.prepare(run, APK_PATH, 'abc;id')).rejects.toThrow(/content key/);
    });

    it('opens one tunnel: the recipe on the Mac port the settings state (Docker holds the Mac 3000), identity and food on their own ports', async () => {
        const { host, tunnels } = makeMacAndroidRig();
        await host.prepare(run, APK_PATH, 'abc123');
        const tunnel = tunnels[0]?.join(' ') ?? '';

        expect(tunnel).toContain('-R 14000:localhost:3110');
        expect(tunnel).toContain('-R 3001:localhost:3111');
        expect(tunnel).toContain('-R 3002:localhost:3112');
        expect(tunnel).not.toContain('-R 3000:');
    });

    it('puts the maestro and adb shims on the lane PATH', async () => {
        const { host, links } = makeMacAndroidRig();
        await host.prepare(run, APK_PATH, 'abc123');

        expect(links.map(([, link]) => link).sort()).toEqual(['/s/shims/adb', '/s/shims/maestro']);
    });

    it('boots the lane emulator on the console port of its serial, through the lane script', async () => {
        const { host, lines } = makeMacAndroidRig();
        await host.prepare(run, APK_PATH, 'abc123');
        await host.boot(lane);

        expect(lines.some((l) => l.includes('androidLaneHost.sh boot ks_lane_lean 5556'))).toBe(true);
    });

    it('answers a failing adb as an exit code, not an exception, so boot polling can go on', async () => {
        const { host } = makeMacAndroidRig({ failing: 'get-state' });
        await host.prepare(run, APK_PATH, 'abc123');

        await expect(host.adb('emulator-5556', 'get-state')).resolves.toMatchObject({ code: 1 });
    });

    it('quotes every adb word, so a value with a space, quote and semicolon is one argument', async () => {
        const { host, lines } = makeMacAndroidRig();
        await host.prepare(run, APK_PATH, 'abc123');
        await host.adb('emulator-5556', 'shell', "a b'c;d");
        const sent = lines[lines.length - 1] ?? '';

        expect(sent).toContain('adb -s emulator-5556 shell');
        expect(sent).not.toContain("shell a b'c;d");
    });

    it('installs the staged APK, and says whether it worked', async () => {
        const ok = makeMacAndroidRig();
        await ok.host.prepare(run, APK_PATH, 'abc123');
        await expect(ok.host.install(lane)).resolves.toEqual({ ok: true, detail: '' });
        expect(
            ok.lines.some((l) =>
                l.includes('androidLaneHost.sh install emulator-5556 /Users/x/ksIos/apps/android/abc123/app.apk'),
            ),
        ).toBe(true);
    });

    it('lets the install error text reach the adapter, so a failure says why', async () => {
        const bad = makeMacAndroidRig({ failing: 'androidLaneHost.sh install' });
        await bad.host.prepare(run, APK_PATH, 'abc123');

        await expect(bad.host.install(lane)).resolves.toEqual({ ok: false, detail: expect.stringContaining('exit 1') });
    });

    it('stops an emulator through the lane script, on abort too', async () => {
        const { host, lines } = makeMacAndroidRig();
        await host.prepare(run, APK_PATH, 'abc123');
        await host.stop(lane);
        await host.abort(lane);

        expect(lines.filter((l) => l.includes('androidLaneHost.sh stop 5556'))).toHaveLength(2);
    });

    it('closes the tunnel on teardown', async () => {
        const { host, stopped } = makeMacAndroidRig();
        await host.prepare(run, APK_PATH, 'abc123');
        await host.teardown();

        expect(stopped()).toBe(1);
    });

    it('answers the loss of its tunnel from the session, so the run learns of it', async () => {
        const { host, exitTunnel } = makeMacAndroidRig();
        await host.prepare(run, APK_PATH, 'abc123');
        exitTunnel(255);

        await expect(host.lost()).resolves.toEqual(new Error('the tunnel ssh exited with code 255 during the run'));
    });
});
