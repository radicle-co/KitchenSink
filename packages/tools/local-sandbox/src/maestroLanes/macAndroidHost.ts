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
import { consolePort } from './androidSerials.js';
import { tunnelsFromManifest } from './iosLane.js';
import type { LaneSpec, RunContext } from './laneTypes.js';
import type { LocalSettings } from './localSettings.js';
import { MacSession, macPathsOf, remote, type MacShell } from './macSession.js';

/**
 * What a Mac Android lane costs, measured with `maestro:macUsage android` on a two-lane full run (2026-11-08, 75 minutes, the
 * 14-cpu Mac, host GPU): a lane's emulator and Maestro JVM used 0.65 to 0.68 cpus on average, p95 1.2, with bursts to 2.5 to
 * 2.7, and peaked at 5.47 to 5.71 GiB resident. The cpu figure is the burst rounded up and the memory the largest peak
 * rounded up. It counts only a lane's own processes (the GPU work runs in Metal), which is what the planner's margin on free
 * memory is for.
 */
const MAC_ANDROID_LANE_COST: LaneCost = { cpus: 3, memBytes: Math.round(5.8 * 1024 ** 3) };

const HEX = /^[0-9a-f]+$/u;

export interface MacAndroidHostOptions {
    readonly shell: MacShell;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly repoRoot: string;
    /** The local stack's origins (the local side of each tunnel), and the lane AVD and the Mac recipe port it states. */
    readonly settings: Pick<
        LocalSettings,
        'recipeOrigin' | 'identityOrigin' | 'foodOrigin' | 'avd' | 'avdConfig' | 'avdImage' | 'macRecipePort'
    >;
    /** The file's text, or `undefined` when it does not exist. */
    readonly readFile: (file: string) => string | undefined;
}

export function createMacAndroidHost(options: MacAndroidHostOptions): AndroidHost {
    const session = new MacSession(options);
    const { avd, avdConfig, macRecipePort } = options.settings;
    const abi = 'arm64-v8a';
    const image = options.settings.avdImage(abi);
    let localApk = '';
    let remoteApk = '';

    const adb: AndroidHost['adb'] = async (serial, ...args) => {
        try {
            const stdout = await session.ssh(
                `. ${remote(session.paths.androidEnv)} && ${remote('adb', '-s', serial, ...args)}`,
            );

            return { code: 0, stdout };
        } catch {
            return { code: 1, stdout: '' };
        }
    };

    return {
        abi,
        laneCost: MAC_ANDROID_LANE_COST,
        hostFacts: () => session.facts(),
        prepare: async (run: RunContext, apk: string, key: string) => {
            if (!HEX.test(key)) {
                throw new Error(`the content key ${JSON.stringify(key)} is not lowercase hex`);
            }

            await session.open(run);
            // An earlier run's emulator holds the AVD and the ports: it goes first, before anything is made ready to boot.
            await session.androidLaneHost('reap', avd);
            await session.androidLaneHost('doctor', image);
            await session.androidLaneHost('ensure-avd', avd, image, ...avdConfig);

            localApk = apk;
            const staged = macPathsOf().androidApp(key);
            remoteApk = `${session.paths.androidApp(key)}/app.apk`;
            await session.ssh(remote('mkdir', '-p', staged));
            await options.shell.run('scp', ['-F', session.sshConfig, apk, `${session.host}:${staged}/app.apk`]);
            await session.syncFlows();
            await session.linkShim('maestro', 'maestroShim.sh');
            await session.linkShim('adb', 'adbShim.sh');

            // The origins the app was built with, read from its own manifest. The first is the recipe service.
            const manifest = options.readFile(apk.replace(/app\.apk$/u, 'testApp.manifest')) ?? '';
            session.openTunnel(
                tunnelsFromManifest(manifest, options.settings).map((tunnel) =>
                    tunnel.origin === 'recipeOrigin' ? { ...tunnel, macPort: macRecipePort } : tunnel,
                ),
            );
        },
        adb,
        boot: async (lane: LaneSpec) => {
            await session.androidLaneHost('boot', avd, consolePort(lane.device));
        },
        install: async (lane: LaneSpec) => {
            try {
                await session.androidLaneHost('install', lane.device, remoteApk);

                return { ok: true, detail: '' };
            } catch (error) {
                return { ok: false, detail: error instanceof Error ? error.message : String(error) };
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
            MAESTRO_LOCAL_RECIPE_HOST_PORT: String(macRecipePort),
            KS_MAC_ANDROID_HOME: session.paths.androidSdk,
            KS_MAC_ANDROID_ENV: session.paths.androidEnv,
        }),
        teardown: () => session.close(),
    };
}
