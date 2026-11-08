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
import { cpus, freemem, loadavg } from 'node:os';
import path from 'node:path';

import type { LaneCost } from '@kitchensink/e2e-plan';
import type { Env } from '@kitchensink/e2e-plan/stampRun';

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
 * What one Android lane costs the host at its PEAK, measured, as ADR-0088 §2 states: an x86_64 API 34 emulator under
 * `swiftshader_indirect` plus its runner and Maestro JVMs. On 2026-11-07 four lanes averaged 2.7 CPUs each, yet load
 * peaked at 58.5 on the 20-CPU host and 9 of 70 flows ran out of their scroll budgets. One lane alone held the host at
 * load p95 4.9, max 5.7, so a lane costs 5.5 CPUs. At that cost the host planned 3 lanes, and 69 of 70 flows passed.
 * Memory: 4.9-5.5 GiB peak per lane.
 */
export const ANDROID_LANE_COST: LaneCost = { cpus: 5.5, memBytes: 5.5 * GIB };

const BOOT_POLL_MS = 2_000;

/** The processes and files the adapter touches, injected so its decisions are testable without a device. */
export interface CommandPort {
    run(
        command: string,
        args: readonly string[],
        options?: { readonly env?: Env; readonly cwd?: string },
    ): Promise<{ readonly code: number; readonly stdout: string; readonly stderr?: string }>;
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
    /** The run's environment, with the Android toolchain in it: the app is built in this, never in the process's own. */
    readonly environment: Env;
}

/** The host's free memory in bytes: `MemAvailable` on Linux. libuv answers 0 when it cannot read it. */
function memAvailableBytes(): number {
    const bytes = freemem();

    if (bytes <= 0) {
        throw new Error('maestro:lanes: the host reported no free memory (os.freemem() is 0)');
    }

    return bytes;
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
        ...options.environment,
        EXPO_PUBLIC_RECIPE_API_URL: options.recipeOrigin,
        EXPO_PUBLIC_IDENTITY_API_URL: options.identityOrigin,
        EXPO_PUBLIC_FOOD_API_URL: options.foodOrigin,
        EXPO_PUBLIC_IDP_PUBLISHABLE_KEY: options.publishableKey,
        TEST_APP_CACHE_EPOCH: options.environment['TEST_APP_CACHE_EPOCH'] ?? '1',
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
        // Async so a refusal rejects, as the port promises, instead of throwing before a promise exists.
        hostFacts: async (): Promise<HostFacts> => ({
            cpus: cpus().length,
            load1: loadavg()[0] ?? 0,
            memAvailable: memAvailableBytes(),
        }),
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
                    const tail = `${built.stdout}\n${built.stderr ?? ''}`.trim().split('\n').slice(-15).join('\n');

                    throw new Error(`maestro:lanes: the Android test app build failed - no lane started:\n${tail}`);
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
