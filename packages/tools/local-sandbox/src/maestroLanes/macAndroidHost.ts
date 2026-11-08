/**
 * The Android emulators on the Mac (ADR-0088 §5): arm64-v8a, booted headless and driven over ssh, because nested emulators on
 * WSL crash Windows. Maestro, adb, the emulators and the logcat reader all run on the Mac through the PATH shims; the runner,
 * the services, the database, the lock and the run-user record stay here. One reverse tunnel carries the Mac ports back to the
 * local services, and the runner's own `adb reverse` (through the shim) points each emulator at those Mac ports.
 *
 * @pattern Bridge — the Mac implementor of {@link AndroidHost}
 * @pattern Facade over {@link MacSession} and `bin/mac/androidLaneHost.sh`
 * @sideEffect Runs commands on the Mac: boots and kills emulators, copies the APK, opens a tunnel.
 */
import type { LaneCost } from '@kitchensink/e2e-plan';

import type { AndroidHost } from './androidHost.js';
import { tunnelsFromManifest } from './iosLane.js';
import type { LaneSpec, RunContext } from './laneTypes.js';
import type { LocalSettings } from './localSettings.js';
import { MacSession, remote, type MacShell } from './macSession.js';

/** What a Mac Android lane costs until a Mac run measures it (lead, 2026-11-08): the WSL peak. */
const MAC_ANDROID_LANE_COST: LaneCost = { cpus: 5.5, memBytes: 5.5 * 1024 ** 3 };

const IMAGE = 'system-images;android-34;google_apis;arm64-v8a';

/**
 * The Mac port the recipe service is tunnelled to: Docker holds the Mac's own 3000, so the runner's `adb reverse tcp:3000`
 * goes to this one (`MAESTRO_LOCAL_RECIPE_HOST_PORT`). Identity and food keep their own ports.
 */
const MAC_RECIPE_TUNNEL_PORT = 13000;

/** The AVD settings copied from the WSL lane AVD: screen, density, cores, RAM and disk. Never restated as numbers here. */
const COPIED_SETTINGS = [
    'hw.lcd.width',
    'hw.lcd.height',
    'hw.lcd.density',
    'hw.cpu.ncore',
    'hw.ramSize',
    'disk.dataPartition.size',
    'disk.cachePartition.size',
    'sdcard.size',
    'vm.heapSize',
] as const;

const HEX = /^[0-9a-f]+$/u;

const consolePort = (serial: string): string => serial.replace(/^emulator-/u, '');

export interface MacAndroidHostOptions {
    readonly shell: MacShell;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly repoRoot: string;
    /** The local stack's origins: the local side of each tunnel. */
    readonly settings: Pick<LocalSettings, 'recipeOrigin' | 'identityOrigin' | 'foodOrigin'>;
    /** The lane AVD's name, on the Mac and on WSL. */
    readonly avd: string;
    /** The WSL lane AVD's `config.ini`: its screen, density, cores, RAM and disk are copied to the Mac's. */
    readonly avdSourceConfig: string;
    /** The file's text, or `undefined` when it does not exist. */
    readonly readFile: (file: string) => string | undefined;
}

/** `key = value` lines of an AVD config, as `key=value` for the copied keys only. */
function copiedSettings(config: string): string[] {
    const found = new Map<string, string>();

    for (const line of config.split('\n')) {
        const match = /^\s*([A-Za-z0-9._]+)\s*=\s*(.*?)\s*$/u.exec(line);

        if (match?.[1] !== undefined && match[2] !== undefined) {
            found.set(match[1], match[2]);
        }
    }

    return COPIED_SETTINGS.flatMap((key) => (found.has(key) ? [`${key}=${found.get(key) ?? ''}`] : []));
}

export function createMacAndroidHost(options: MacAndroidHostOptions): AndroidHost {
    const session = new MacSession(options);
    let localApk = '';
    let remoteApk = '';

    const adb: AndroidHost['adb'] = async (serial, ...args) => {
        try {
            const stdout = await session.ssh(
                `. ${remote(`${session.macHome}/ksAndroid/env.sh`)} && ${remote('adb', '-s', serial, ...args)}`,
            );

            return { code: 0, stdout };
        } catch {
            return { code: 1, stdout: '' };
        }
    };

    return {
        abi: 'arm64-v8a',
        laneCost: MAC_ANDROID_LANE_COST,
        hostFacts: () => session.facts(),
        prepare: async (run: RunContext, apk: string, key: string) => {
            if (!HEX.test(key)) {
                throw new Error(`the content key ${JSON.stringify(key)} is not lowercase hex`);
            }

            const config = options.readFile(options.avdSourceConfig);

            if (config === undefined) {
                throw new Error(
                    `the WSL ${options.avd} config ${options.avdSourceConfig} is not there: the Mac AVD copies its screen, density, cores, RAM and disk from it`,
                );
            }

            await session.open(run);
            // An earlier run's emulator holds the AVD and the ports: it goes first, before anything is made ready to boot.
            await session.androidLaneHost('reap', options.avd);
            await session.androidLaneHost('doctor', IMAGE);
            await session.androidLaneHost('ensure-avd', options.avd, IMAGE, ...copiedSettings(config));

            localApk = apk;
            remoteApk = `${session.macHome}/ksIos/apps/android/${key}/app.apk`;
            await session.ssh(remote('mkdir', '-p', `ksIos/apps/android/${key}`));
            await options.shell.run('scp', [
                '-F',
                session.sshConfig,
                apk,
                `${session.host}:ksIos/apps/android/${key}/app.apk`,
            ]);
            await session.syncFlows();
            await session.linkShim('maestro', 'maestroShim.sh');
            await session.linkShim('adb', 'adbShim.sh');

            // The origins the app was built with, read from its own manifest. The first is the recipe service.
            const manifest = options.readFile(apk.replace(/app\.apk$/u, 'testApp.manifest')) ?? '';
            session.openTunnel(
                tunnelsFromManifest(manifest, options.settings).map((tunnel, index) =>
                    index === 0 ? { ...tunnel, macPort: MAC_RECIPE_TUNNEL_PORT } : tunnel,
                ),
            );
        },
        adb,
        boot: async (lane: LaneSpec) => {
            await session.androidLaneHost('boot', options.avd, consolePort(lane.device));
        },
        install: async (lane: LaneSpec) => {
            try {
                await session.androidLaneHost('install', lane.device, remoteApk);

                return true;
            } catch {
                return false;
            }
        },
        abort: async (lane: LaneSpec) => {
            await session.androidLaneHost('stop', consolePort(lane.device));
        },
        stop: async (lane: LaneSpec) => {
            await session.androidLaneHost('stop', consolePort(lane.device));
        },
        laneEnv: (lane: LaneSpec) => ({
            ...session.shimEnv(lane.index),
            ANDROID_SERIAL: lane.device,
            MAESTRO_ANDROID_APK: localApk,
            MAESTRO_SKIP_INSTALL: '1',
            MAESTRO_LOCAL_RECIPE_HOST_PORT: String(MAC_RECIPE_TUNNEL_PORT),
            KS_MAC_ANDROID_HOME: `${session.macHome}/ksAndroid/sdk`,
            KS_MAC_ANDROID_ENV: `${session.macHome}/ksAndroid/env.sh`,
        }),
        teardown: () => session.close(),
    };
}
