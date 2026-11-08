/**
 * Where an Android lane's emulator runs. The adapter keeps the content key, the build, the verification, the serial table and
 * the boot polling; a host does the boot, the install, the stop and the host facts (ADR-0088 §5). There are two: the local one
 * (an x86_64 emulator on this machine) and the Mac one (an arm64-v8a emulator over ssh).
 *
 * @pattern Bridge — {@link AndroidHost} is the implementor behind the Android adapter's abstraction
 */
import { cpus, freemem, loadavg } from 'node:os';

import type { LaneCost } from '@kitchensink/e2e-plan';

import type { CommandPort } from './androidAdapter.js';
import type { HostFacts, LaneSpec, RunContext } from './laneTypes.js';

export type AndroidAbi = 'x86_64' | 'arm64-v8a';

export interface AndroidHost {
    /** The ABI of the emulators this host boots: the test app is built for it. */
    readonly abi: AndroidAbi;
    readonly laneCost: LaneCost;
    hostFacts(): Promise<HostFacts>;
    /** Once per run, after the app is built and verified and before any lane: make the host ready and stage the APK. */
    prepare(run: RunContext, apk: string, key: string): Promise<void>;
    /** `adb -s <serial> ...` on the machine that holds the emulator. */
    adb(serial: string, ...args: string[]): Promise<{ readonly code: number; readonly stdout: string }>;
    /** Start the lane's emulator. Returns as soon as it is started, not when it has booted. */
    boot(lane: LaneSpec): Promise<void>;
    /** Install the staged APK. True when it installed. */
    install(lane: LaneSpec): Promise<boolean>;
    /** Stop an emulator whose boot never completed. */
    abort(lane: LaneSpec): Promise<void>;
    stop(lane: LaneSpec): Promise<void>;
    laneEnv(lane: LaneSpec): Readonly<Record<string, string>>;
    teardown(): Promise<void>;
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

export interface LocalAndroidHostOptions {
    readonly commands: CommandPort;
    readonly avd: string;
    readonly apk: string;
    readonly laneCost: LaneCost;
}

/**
 * The emulator on THIS machine: x86_64, booted and killed through the command port. WSL only on request
 * (`LOCAL_MAESTRO_ANDROID_ON=wsl`): nested emulators crashed Windows twice.
 *
 * @sideEffect Boots and kills emulators.
 */
export function createLocalAndroidHost(options: LocalAndroidHostOptions): AndroidHost {
    const { commands } = options;
    const booted = new Map<string, number>();
    const adb: AndroidHost['adb'] = (serial, ...args) => commands.run('adb', ['-s', serial, ...args]);

    return {
        abi: 'x86_64',
        laneCost: options.laneCost,
        // Async so a refusal rejects, as the port promises, instead of throwing before a promise exists.
        hostFacts: async (): Promise<HostFacts> => ({
            cpus: cpus().length,
            load1: loadavg()[0] ?? 0,
            memAvailable: memAvailableBytes(),
        }),
        prepare: () => Promise.resolve(),
        adb,
        boot: (lane) => {
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
                `${lane.stateDir}/emulator.log`,
            );
            booted.set(lane.device, pid);

            return Promise.resolve();
        },
        install: async (lane) => (await adb(lane.device, 'install', '-r', options.apk)).code === 0,
        abort: (lane) => {
            const pid = booted.get(lane.device);

            if (pid !== undefined) {
                commands.killGroup(pid);
                booted.delete(lane.device);
            }

            return Promise.resolve();
        },
        stop: async (lane) => {
            const pid = booted.get(lane.device);

            if (pid === undefined) {
                return;
            }

            await adb(lane.device, 'emu', 'kill');
            commands.killGroup(pid);
            booted.delete(lane.device);
        },
        laneEnv: (lane) => ({
            ANDROID_SERIAL: lane.device,
            MAESTRO_ANDROID_APK: options.apk,
            MAESTRO_SKIP_INSTALL: '1',
        }),
        teardown: () => Promise.resolve(),
    };
}
