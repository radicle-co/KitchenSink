import { describe, expect, it } from 'vitest';

import { createAndroidAdapter } from '../androidAdapter.js';
import type { AndroidHost } from '../androidHost.js';
import type { CommandPort, LaneSpec } from '../laneTypes.js';

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
    readonly adapter: ReturnType<typeof createAndroidAdapter>;
    readonly hostCalls: string[];
    readonly envs: Record<string, string | undefined>[];
    readonly commands: string[];
}

/** An adapter over a recording host and a recording command port: what the adapter keeps and what it hands the host. */
function rig(abi: 'x86_64' | 'arm64-v8a', manifest = 'contentKey=k1\n'): Rig {
    const hostCalls: string[] = [];
    const envs: Record<string, string | undefined>[] = [];
    const commands: string[] = [];
    let polls = 0;
    const host: AndroidHost = {
        abi,
        laneCost: { cpus: 5.5, memBytes: 5.5 * 1024 ** 3 },
        hostFacts: () => Promise.resolve({ cpus: 10, load1: 0, memAvailable: 1 }),
        prepare: (run, apk, key) => {
            hostCalls.push(`prepare ${run.runId} ${apk} ${key}`);

            return Promise.resolve();
        },
        adb: (serial, ...args) => {
            hostCalls.push(`adb ${serial} ${args.join(' ')}`);
            polls += args.includes('sys.boot_completed') ? 1 : 0;

            return Promise.resolve({ code: 0, stdout: args.includes('sys.boot_completed') && polls >= 2 ? '1\n' : '' });
        },
        boot: (l) => {
            hostCalls.push(`boot ${l.device}`);

            return Promise.resolve();
        },
        install: (l) => {
            hostCalls.push(`install ${l.device}`);

            return Promise.resolve({ ok: true, detail: '' });
        },
        abort: (l) => {
            hostCalls.push(`abort ${l.device}`);

            return Promise.resolve();
        },
        stop: (l) => {
            hostCalls.push(`stop ${l.device}`);

            return Promise.resolve();
        },
        laneEnv: (l) => ({ ANDROID_SERIAL: l.device, FROM_HOST: '1' }),
        teardown: () => {
            hostCalls.push('teardown');

            return Promise.resolve();
        },
    };
    const port: CommandPort = {
        run: (command, args, options) => {
            commands.push([command, ...args].join(' '));
            envs.push({ ...(options?.env ?? {}) });

            return Promise.resolve({ code: 0, stdout: args.includes('content-key') ? 'k1\n' : '' });
        },
        spawnDetached: () => ({ pid: 1 }),
        killGroup: () => undefined,
        sleep: () => Promise.resolve(),
        readFile: () => manifest,
    };
    const adapter = createAndroidAdapter({
        repoRoot: '/repo',
        avd: 'ks_lane_lean',
        recipeOrigin: 'http://localhost:3000',
        identityOrigin: 'http://localhost:3001',
        foodOrigin: 'http://localhost:3002',
        publishableKey: 'pk_test_fake',
        commands: port,
        bootTimeoutMs: 60_000,
        environment: {},
        host,
    });

    return { adapter, hostCalls, envs, commands };
}

describe('the Android adapter over an injected host', () => {
    it('asks the host for the facts, the cost and the lane environment', async () => {
        const { adapter } = rig('arm64-v8a');

        expect(adapter.laneCost.cpus).toBe(5.5);
        await expect(adapter.hostFacts()).resolves.toMatchObject({ cpus: 10 });
        expect(adapter.laneEnv(lane)).toEqual({ ANDROID_SERIAL: 'emulator-5556', FROM_HOST: '1' });
    });

    it('hands the host ABI to the content key, the build and the verification, so the three agree', async () => {
        const { adapter, envs, commands } = rig('arm64-v8a', 'contentKey=other\n');
        await adapter.prepareHost({ runId: 'r', stateDir: '/state', repoRoot: '/repo' });

        for (const step of ['content-key android', 'buildTestApp.sh android', 'verify-manifest']) {
            const at = commands.findIndex((c) => c.includes(step));

            expect(at, step).toBeGreaterThanOrEqual(0);
            expect(envs[at]?.['TEST_APP_ANDROID_ABIS'], step).toBe('arm64-v8a');
        }
    });

    it('prepares the host with the run, the APK path and the content key, after the app is verified', async () => {
        const { adapter, hostCalls, commands } = rig('arm64-v8a');
        await adapter.prepareHost({ runId: 'r', stateDir: '/state', repoRoot: '/repo' });

        expect(commands.some((c) => c.includes('verify-manifest'))).toBe(true);
        expect(hostCalls).toEqual(['prepare r /repo/packages/apps/commise/mobile/dist-testApp/android/app.apk k1']);
    });

    it('boots through the host, polls boot through the host, then installs through the host', async () => {
        const { adapter, hostCalls } = rig('arm64-v8a');
        await adapter.startDevice(lane);

        expect(hostCalls[0]).toBe('adb emulator-5556 get-state');
        expect(hostCalls).toContain('boot emulator-5556');
        expect(hostCalls.filter((c) => c.includes('sys.boot_completed')).length).toBeGreaterThanOrEqual(2);
        expect(hostCalls[hostCalls.length - 1]).toBe('install emulator-5556');
        expect(hostCalls.indexOf('boot emulator-5556')).toBeLessThan(hostCalls.indexOf('install emulator-5556'));
    });

    it('stops and tears down through the host', async () => {
        const { adapter, hostCalls } = rig('arm64-v8a');
        await adapter.startDevice(lane);
        await adapter.stopDevice(lane);
        await adapter.teardownHost();

        expect(hostCalls).toContain('stop emulator-5556');
        expect(hostCalls[hostCalls.length - 1]).toBe('teardown');
    });
});
