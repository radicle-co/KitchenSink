import { describe, expect, it } from 'vitest';

import { ANDROID_LANE_SERIALS, createAndroidAdapter, type CommandPort } from '../androidAdapter.js';
import type { LaneSpec } from '../laneTypes.js';

const ORIGINS = {
    recipeOrigin: 'http://localhost:3000',
    identityOrigin: 'http://localhost:3001',
    foodOrigin: 'http://localhost:3002',
    publishableKey: 'pk_test_fake',
} as const;

const lane = (index: number, serial = ANDROID_LANE_SERIALS[index - 1] ?? 'none'): LaneSpec => ({
    platform: 'android',
    index,
    count: 2,
    device: serial,
    driverPort: 7000 + index,
    stateDir: `/state/lanes/android-${index}`,
    fixtureEnvFile: `/state/lanes/android-${index}/fixture.env`,
});

interface Scripted {
    readonly calls: string[];
    readonly port: CommandPort;
}

/**
 * A command port that records every call and answers from a script: `answers[command]` is the stdout and exit code a
 * call whose joined argv contains the key gets (first match wins).
 */
function scripted(answers: readonly (readonly [string, string, number])[], manifest?: string): Scripted {
    const calls: string[] = [];
    let bootPolls = 0;

    return {
        calls,
        port: {
            run: (command, args, options) => {
                const line = [command, ...args].join(' ');
                const env = options?.env ?? {};
                calls.push(
                    `${line}${env['EXPECT_CONTENT_KEY'] === undefined ? '' : ` [EXPECT_CONTENT_KEY=${env['EXPECT_CONTENT_KEY']}]`}`,
                );

                if (line.includes('sys.boot_completed')) {
                    bootPolls += 1;

                    return Promise.resolve({ code: 0, stdout: bootPolls >= 2 ? '1\r\n' : '' });
                }

                const answer = answers.find(([key]) => line.includes(key));

                return Promise.resolve({ code: answer?.[2] ?? 0, stdout: answer?.[1] ?? '' });
            },
            spawnDetached: (command, args, log) => {
                calls.push(`spawn ${[command, ...args].join(' ')} > ${log}`);

                return { pid: 4321 };
            },
            killGroup: (pid) => {
                calls.push(`killGroup ${pid}`);
            },
            sleep: () => Promise.resolve(),
            readFile: () => manifest,
        },
    };
}

const adapter = (port: CommandPort) =>
    createAndroidAdapter({ ...ORIGINS, repoRoot: '/repo', avd: 'ci_pixel6', commands: port, bootTimeoutMs: 60_000 });

describe('the Android lane devices', () => {
    it('is the serial table, as a literal, starting past emulator-5554', () => {
        expect(ANDROID_LANE_SERIALS).toEqual([
            'emulator-5556',
            'emulator-5558',
            'emulator-5560',
            'emulator-5562',
            'emulator-5564',
            'emulator-5566',
            'emulator-5568',
            'emulator-5570',
        ]);
        expect(adapter(scripted([]).port).maxLanes).toBe(8);
    });

    it('names lane k by the table, and refuses a lane past it', () => {
        const android = adapter(scripted([]).port);

        expect(android.deviceFor(1)).toBe('emulator-5556');
        expect(android.deviceFor(8)).toBe('emulator-5570');
        expect(() => android.deviceFor(9)).toThrow(/lane 9/u);
        expect(() => android.deviceFor(0)).toThrow();
    });
});

describe('startDevice — boot an emulator the lane owns, then install the app', () => {
    it('boots read-only, without a snapshot or a window, on the lane port, waits for boot, then installs', async () => {
        const { calls, port } = scripted([['get-state', 'error: device not found', 1]]);

        await adapter(port).startDevice(lane(2));

        const spawn = calls.find((call) => call.startsWith('spawn emulator')) ?? '';
        expect(spawn).toContain('-avd ci_pixel6');
        expect(spawn).toContain('-port 5558');

        for (const flag of ['-read-only', '-no-snapshot', '-no-window']) {
            expect(spawn).toContain(flag);
        }

        expect(spawn).toContain('/state/lanes/android-2/emulator.log');

        const install = calls.findIndex((call) => call.includes('-s emulator-5558 install -r'));
        const booted = calls.findIndex((call) => call.includes('sys.boot_completed'));
        expect(install).toBeGreaterThan(booted);
        expect(calls[install]).toContain('/repo/packages/apps/commise/mobile/dist-testApp/android/app.apk');
    });

    it('refuses a serial that is already attached - a lane never adopts a device it did not boot', async () => {
        const { calls, port } = scripted([['get-state', 'device', 0]]);

        await expect(adapter(port).startDevice(lane(1))).rejects.toThrow(/emulator-5556.*already/u);
        expect(calls.some((call) => call.startsWith('spawn'))).toBe(false);
    });

    it('stops the emulator it booted when the boot never completes', async () => {
        const calls: string[] = [];
        const port: CommandPort = {
            ...scripted([['get-state', '', 1]]).port,
            run: (command, args) => {
                calls.push([command, ...args].join(' '));

                return Promise.resolve({ code: 1, stdout: '' });
            },
            spawnDetached: () => ({ pid: 99 }),
            killGroup: (pid) => {
                calls.push(`killGroup ${pid}`);
            },
        };

        await expect(
            createAndroidAdapter({
                ...ORIGINS,
                repoRoot: '/repo',
                avd: 'ci_pixel6',
                commands: port,
                bootTimeoutMs: 0,
            }).startDevice(lane(1)),
        ).rejects.toThrow(/did not finish booting/u);
        expect(calls).toContain('killGroup 99');
    });
});

describe('laneEnv — what the runner needs to drive this lane', () => {
    it('names the device, the app, and that the app is installed', () => {
        expect(adapter(scripted([]).port).laneEnv(lane(3))).toEqual({
            ANDROID_SERIAL: 'emulator-5560',
            MAESTRO_ANDROID_APK: '/repo/packages/apps/commise/mobile/dist-testApp/android/app.apk',
            MAESTRO_SKIP_INSTALL: '1',
        });
    });
});

describe('stopDevice', () => {
    it('kills the emulator by serial and its process group', async () => {
        const { calls, port } = scripted([['get-state', '', 1]]);
        const android = adapter(port);

        await android.startDevice(lane(1));
        await android.stopDevice(lane(1));

        expect(calls).toContain('adb -s emulator-5556 emu kill');
        expect(calls).toContain('killGroup 4321');
    });
});

describe('prepareHost — the embedded-bundle test app, built only when its content changed', () => {
    const run = { runId: 'r', stateDir: '/state', repoRoot: '/repo' };

    it('reuses the built app when its manifest holds the current content key, and still verifies it', async () => {
        const { calls, port } = scripted([['content-key', 'abc123\n', 0]], 'platform=android\ncontentKey=abc123\n');

        await adapter(port).prepareHost(run);

        expect(calls.some((call) => /\/buildTestApp\.sh android$/u.test(call))).toBe(false);
        expect(
            calls.some((call) => call.includes('verify-manifest') && call.includes('EXPECT_CONTENT_KEY=abc123')),
        ).toBe(true);
    });

    it('builds when the key differs, then verifies', async () => {
        const { calls, port } = scripted([['content-key', 'def456\n', 0]], 'platform=android\ncontentKey=abc123\n');

        await adapter(port).prepareHost(run);

        const build = calls.findIndex((call) => /\/buildTestApp\.sh android$/u.test(call));
        const verify = calls.findIndex((call) => call.includes('verify-manifest'));
        expect(build).toBeGreaterThan(-1);
        expect(verify).toBeGreaterThan(build);
    });

    it('builds when there is no app yet', async () => {
        const { calls, port } = scripted([['content-key', 'def456\n', 0]]);

        await adapter(port).prepareHost(run);

        expect(calls.some((call) => /\/buildTestApp\.sh android$/u.test(call))).toBe(true);
    });

    it.each([
        [
            'the build fails',
            [
                ['content-key', 'k1\n', 0],
                [' android', '', 1],
            ] as const,
        ],
        [
            'the manifest does not verify',
            [
                ['content-key', 'k1\n', 0],
                ['verify-manifest', '', 1],
            ] as const,
        ],
        ['there is no content key', [['content-key', '', 0]] as const],
    ])('refuses to drive an app when %s', async (_label, answers) => {
        const { port } = scripted(answers, 'contentKey=k1\n');

        await expect(adapter(port).prepareHost(run)).rejects.toThrow(/test app/u);
    });
});
