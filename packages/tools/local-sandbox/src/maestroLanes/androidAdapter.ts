/**
 * The Android lane device: one emulator per lane, booted by the lane and never adopted, driving the embedded-bundle
 * Release test app (`buildTestApp.sh android`) built against the local services' loopback origins.
 *
 * The embedded build removes Metro from a lane: no launch race on a cold bundle, no debug-only Tamagui warning toast,
 * and one binary for every lane, of the shape CI and iOS drive. It is rebuilt only when turbo's content key for it
 * changes, and every run verifies its manifest against the origins this run expects before any lane installs it.
 *
 * @pattern Strategy — the Android {@link DeviceAdapter}
 * @pattern Adapter over the Android emulator, adb and `buildTestApp.sh`, behind the injected {@link CommandPort}
 */
import { cpus, loadavg } from 'node:os';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { LaneCost } from '@kitchensink/e2e-plan';

import type { DeviceAdapter, HostFacts, LaneSpec, RunContext } from './laneTypes.js';

/** The lanes' emulators, by lane. Never `emulator-5554`: that one is the owner's. */
export const ANDROID_LANE_SERIALS = [
    'emulator-5556',
    'emulator-5558',
    'emulator-5560',
    'emulator-5562',
    'emulator-5564',
    'emulator-5566',
    'emulator-5568',
    'emulator-5570',
] as const;

const GIB = 1024 ** 3;

/**
 * What one Android lane costs the host: an x86_64 API 34 emulator under `swiftshader_indirect` plus its runner and
 * Maestro JVM. ⚠️ An ESTIMATE until the lane proof measures it; the proof's report records the measured figure.
 */
export const ANDROID_LANE_COST: LaneCost = { cpus: 3, memBytes: 4 * GIB };

const BOOT_POLL_MS = 2_000;

export type Env = Readonly<Record<string, string | undefined>>;

/** The processes and files the adapter touches, injected so its decisions are testable without a device. */
export interface CommandPort {
    run(
        command: string,
        args: readonly string[],
        options?: { readonly env?: Env; readonly cwd?: string },
    ): Promise<{ readonly code: number; readonly stdout: string }>;
    /** Start a long-lived process in its own process group, logging to `log`. */
    spawnDetached(command: string, args: readonly string[], log: string): { readonly pid: number };
    killGroup(pid: number): void;
    sleep(ms: number): Promise<void>;
    /** The file's text, or `undefined` when it does not exist. */
    readFile(file: string): string | undefined;
}

export interface AndroidAdapterOptions {
    readonly repoRoot: string;
    readonly avd: string;
    /** The origins and key the app is built with: the local services, on loopback. */
    readonly recipeOrigin: string;
    readonly identityOrigin: string;
    readonly foodOrigin: string;
    readonly publishableKey: string;
    readonly commands: CommandPort;
    readonly bootTimeoutMs: number;
}

/** `MemAvailable` from `/proc/meminfo`, in bytes. */
function memAvailableBytes(): number {
    const kib = /^MemAvailable:\s+(\d+)\s+kB$/mu.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1];

    if (kib === undefined) {
        throw new Error('maestro:lanes: /proc/meminfo has no MemAvailable line');
    }

    return Number(kib) * 1024;
}

const consolePort = (serial: string): string => serial.replace(/^emulator-/u, '');

/**
 * The Android {@link DeviceAdapter}.
 *
 * @sideEffect The returned adapter boots and kills emulators, installs the app, and may build it.
 */
export function createAndroidAdapter(options: AndroidAdapterOptions): DeviceAdapter {
    const { commands } = options;
    const mobileDir = path.join(options.repoRoot, 'packages/apps/commise/mobile');
    const apk = path.join(mobileDir, 'dist-testApp/android/app.apk');
    const manifest = path.join(mobileDir, 'dist-testApp/android/testApp.manifest');
    const script = path.join(mobileDir, 'scripts/buildTestApp.sh');
    const booted = new Map<string, number>();
    const buildEnv: Env = {
        ...process.env,
        EXPO_PUBLIC_RECIPE_API_URL: options.recipeOrigin,
        EXPO_PUBLIC_IDENTITY_API_URL: options.identityOrigin,
        EXPO_PUBLIC_FOOD_API_URL: options.foodOrigin,
        EXPO_PUBLIC_IDP_PUBLISHABLE_KEY: options.publishableKey,
        TEST_APP_CACHE_EPOCH: process.env['TEST_APP_CACHE_EPOCH'] ?? '1',
    };

    const deviceFor = (index: number): string => {
        const serial = ANDROID_LANE_SERIALS[index - 1];

        if (!Number.isInteger(index) || serial === undefined) {
            throw new Error(
                `maestro:lanes: Android has no emulator for lane ${index} (the table holds ${ANDROID_LANE_SERIALS.length})`,
            );
        }

        return serial;
    };

    const adb = (serial: string, ...args: string[]) => commands.run('adb', ['-s', serial, ...args]);

    return {
        platform: 'android',
        laneCost: ANDROID_LANE_COST,
        maxLanes: ANDROID_LANE_SERIALS.length,
        hostFacts: (): Promise<HostFacts> =>
            Promise.resolve({ cpus: cpus().length, load1: loadavg()[0] ?? 0, memAvailable: memAvailableBytes() }),
        prepareHost: async (_run: RunContext) => {
            const keyed = await commands.run('bash', [script, 'content-key', 'android'], {
                env: buildEnv,
                cwd: options.repoRoot,
            });
            const key = keyed.stdout.trim();

            if (keyed.code !== 0 || key === '') {
                throw new Error('maestro:lanes: could not compute the Android test app content key');
            }

            const builtKey = /^contentKey=(.*)$/mu.exec(commands.readFile(manifest) ?? '')?.[1];

            if (builtKey !== key) {
                const built = await commands.run('bash', [script, 'android'], {
                    env: { ...buildEnv, TEST_APP_CONTENT_KEY: key },
                    cwd: options.repoRoot,
                });

                if (built.code !== 0) {
                    throw new Error('maestro:lanes: the Android test app build failed - no lane started');
                }
            }

            const verified = await commands.run('bash', [script, 'verify-manifest', manifest, 'android'], {
                env: {
                    ...buildEnv,
                    EXPECT_CONTENT_KEY: key,
                    EXPECT_RECIPE_ORIGIN: options.recipeOrigin,
                    EXPECT_FOOD_ORIGIN: options.foodOrigin,
                    EXPECT_IDENTITY_ORIGIN: options.identityOrigin,
                    EXPECT_PUBLISHABLE_KEY: options.publishableKey,
                },
                cwd: options.repoRoot,
            });

            if (verified.code !== 0) {
                throw new Error(
                    'maestro:lanes: the Android test app is not the one this run expects - refusing to drive it',
                );
            }
        },
        deviceFor,
        startDevice: async (lane: LaneSpec) => {
            const attached = await adb(lane.device, 'get-state');

            if (attached.code === 0 && attached.stdout.trim() === 'device') {
                throw new Error(
                    `maestro:lanes: ${lane.device} is already attached, and this run did not boot it - stop it first`,
                );
            }

            const { pid } = commands.spawnDetached(
                'emulator',
                [
                    '-avd',
                    options.avd,
                    '-port',
                    consolePort(lane.device),
                    '-read-only',
                    '-no-snapshot',
                    '-no-window',
                    '-no-audio',
                    '-no-boot-anim',
                    '-gpu',
                    'swiftshader_indirect',
                ],
                path.join(lane.stateDir, 'emulator.log'),
            );
            booted.set(lane.device, pid);

            const polls = Math.max(1, Math.ceil(options.bootTimeoutMs / BOOT_POLL_MS));
            let up = false;

            for (let poll = 0; poll < polls && !up; poll += 1) {
                await commands.sleep(BOOT_POLL_MS);
                up = (await adb(lane.device, 'shell', 'getprop', 'sys.boot_completed')).stdout.trim() === '1';
            }

            if (!up) {
                commands.killGroup(pid);
                booted.delete(lane.device);
                throw new Error(
                    `maestro:lanes: ${lane.device} did not finish booting - log: ${lane.stateDir}/emulator.log`,
                );
            }

            const installed = await adb(lane.device, 'install', '-r', apk);

            if (installed.code !== 0) {
                throw new Error(`maestro:lanes: installing the test app on ${lane.device} failed`);
            }
        },
        laneEnv: (lane: LaneSpec) => ({
            ANDROID_SERIAL: lane.device,
            MAESTRO_ANDROID_APK: apk,
            MAESTRO_SKIP_INSTALL: '1',
        }),
        stopDevice: async (lane: LaneSpec) => {
            const pid = booted.get(lane.device);

            if (pid === undefined) {
                return;
            }

            await adb(lane.device, 'emu', 'kill');
            commands.killGroup(pid);
            booted.delete(lane.device);
        },
        teardownHost: () => Promise.resolve(),
    };
}
