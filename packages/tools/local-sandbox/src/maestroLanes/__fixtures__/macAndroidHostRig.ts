import type { AndroidHost } from '../androidHost.js';
import { createMacAndroidHost, type MacAndroidHostOptions } from '../macAndroidHost.js';
import type { MacShell } from '../macSession.js';
import type { LaneSpec, RunContext } from '../laneTypes.js';

const MANIFEST = [
    'platform=android',
    'recipeOrigin=http://localhost:3000',
    'identityOrigin=http://localhost:3001',
    'foodOrigin=http://localhost:3002',
].join('\n');

/** The host ports the running stack publishes: three different ports, so a swap of two services shows. */
export const HOST_PORTS = { recipes: 3110, identity: 3111, food: 3112 };

/** The settings a Mac Android host reads, with values no real AVD or image has, so a number written in the host shows. */
export const makeSettings = (overrides: Partial<MacAndroidHostOptions['settings']> = {}) => ({
    avd: 'ks_lane_lean',
    avdConfig: [
        'hw.lcd.width=999',
        'hw.lcd.height=1777',
        'hw.lcd.density=333',
        'hw.cpu.ncore=3',
        'hw.ramSize=1111M',
        'disk.dataPartition.size=123456',
        'sdcard.size=512 MB',
        'vm.heapSize=228M',
    ],
    avdImage: (abi: string) => `image;from;settings;${abi}`,
    macRecipePort: 14000,
    ...overrides,
});

export const makeLane = (overrides: Partial<LaneSpec> = {}): LaneSpec => ({
    platform: 'android',
    index: 1,
    count: 1,
    device: 'emulator-5556',
    driverPort: 7001,
    stateDir: '/state/lanes/android-1',
    fixtureEnvFile: '/state/lanes/android-1/fixture.env',
    ...overrides,
});

export const makeRun = (overrides: Partial<RunContext> = {}): RunContext => ({
    runId: 'r',
    stateDir: '/s',
    repoRoot: '/repo',
    ...overrides,
});

/** Where the test app's APK sits on the runner, as `prepare` is handed it. */
export const APK_PATH = '/repo/packages/apps/commise/mobile/dist-testApp/android/app.apk';

export interface MacAndroidRig {
    readonly host: AndroidHost;
    readonly lines: string[];
    readonly tunnels: string[][];
    readonly links: [string, string][];
    readonly stopped: () => number;
    /** Ends the tunnel's ssh with this exit code, as if it died. */
    readonly exitTunnel: (code: number) => void;
}

/**
 * A Mac Android host over a REAL `MacSession` and a scripted shell: it records every command line, answers
 * `printenv HOME` with `/Users/x`, and fails a command that contains `failing`.
 *
 * @param options - `failing`: a text whose command line the shell rejects.
 * @returns The host and what its shell saw. Impure only through the arrays it fills.
 */
export function makeMacAndroidRig(options: { failing?: string } = {}): MacAndroidRig {
    const lines: string[] = [];
    const tunnels: string[][] = [];
    const links: [string, string][] = [];
    let stopped = 0;
    let exitTunnel: (code: number) => void = () => undefined;
    const exited = new Promise<number>((resolve) => {
        exitTunnel = resolve;
    });
    const shell: MacShell = {
        run: (command, args) => {
            const line = [command, ...args].join(' ');
            lines.push(line);

            if (options.failing !== undefined && line.includes(options.failing)) {
                return Promise.reject(new Error('exit 1'));
            }

            return Promise.resolve(
                line.includes('printenv HOME') ? '/Users/x\n' : line.includes('/health') ? '200' : '',
            );
        },
        background: (command, args) => {
            tunnels.push([command, ...args]);

            return {
                stop: () => {
                    stopped += 1;

                    return Promise.resolve();
                },
                exited,
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
        hostPorts: HOST_PORTS,
        settings: makeSettings(),
        readFile: (file) => (file.endsWith('testApp.manifest') ? MANIFEST : undefined),
    });

    return { host, lines, tunnels, links, stopped: () => stopped, exitTunnel: (code) => exitTunnel(code) };
}
