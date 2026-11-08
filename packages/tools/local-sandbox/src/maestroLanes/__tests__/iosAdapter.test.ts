import { describe, expect, it } from 'vitest';

import { IosAdapter, type IosShell } from '../iosAdapter.js';

const MANIFEST = [
    'platform=ios',
    'contentKey=abc',
    'recipeOrigin=http://localhost:13000',
    'foodOrigin=http://localhost:13002',
    'identityOrigin=http://localhost:13001',
].join('\n');

const FACTS = 'ncpu 14\nmemsize 100\nloadavg { 1.5 1 1 }\nmemfreepct 50\n';

interface Recorder {
    readonly shell: IosShell;
    readonly commands: string[];
    readonly tunnels: string[][];
    readonly files: Map<string, string>;
    stopped: number;
}

/** A shell whose answers are scripted by the command line it is asked to run. */
function makeShell(answers: Record<string, string> = {}): Recorder {
    const recorder: Recorder = {
        commands: [],
        tunnels: [],
        files: new Map(),
        stopped: 0,
        shell: {
            run: (command, args) => {
                const line = [command, ...args].join(' ');
                recorder.commands.push(line);
                const hit = Object.entries({ 'printenv HOME': '/Users/x\n', ...answers }).find(([needle]) =>
                    line.includes(needle),
                );

                return Promise.resolve(hit === undefined ? '' : hit[1]);
            },
            background: (command, args) => {
                recorder.tunnels.push([command, ...args]);

                return {
                    stop: () => {
                        recorder.stopped += 1;

                        return Promise.resolve();
                    },
                };
            },
            writeFile: (file, content) => {
                recorder.files.set(file, content);

                return Promise.resolve();
            },
            linkFile: () => Promise.resolve(),
        },
    };

    return recorder;
}

const SETTINGS = {
    recipeOrigin: 'http://localhost:3000',
    identityOrigin: 'http://localhost:3001',
    foodOrigin: 'http://localhost:3002',
};

const options = (
    shell: IosShell,
    env: Record<string, string | undefined> = { LOCAL_MAESTRO_IOS_HOST: 'me@mac' },
    settings = SETTINGS,
) => ({
    shell,
    env,
    repoRoot: '/repo',
    settings,
});

describe('IosAdapter', () => {
    it('is capped at five lanes', () => {
        expect(new IosAdapter(options(makeShell().shell)).maxLanes).toBe(5);
    });

    it('costs a lane what the 2026-11-08 three-lane run measured: peak 2.05 GiB and under one cpu busy', () => {
        // Measured on the Mac with maestro:macUsage over 3 lanes and 49 minutes: mean 0.5 to 0.6 cpus per lane with a
        // one-cpu burst, peak resident 1.74 to 2.05 GiB per lane (the Simulator, its XCTest driver and the Maestro JVM).
        const { cpus, memBytes } = new IosAdapter(options(makeShell().shell)).laneCost;
        expect(cpus).toBe(1);
        expect(memBytes).toBe(Math.round(2.1 * 1024 ** 3));
    });

    it('refuses to be built without a Mac host', () => {
        expect(() => new IosAdapter(options(makeShell().shell, {}))).toThrow(/LOCAL_MAESTRO_IOS_HOST/);
    });

    it('names a lane device by its lane, purely', () => {
        const adapter = new IosAdapter(options(makeShell().shell));
        expect(adapter.deviceFor(2)).toBe('ks-maestro-lane-2');
        expect(() => adapter.deviceFor(6)).toThrow();
    });

    it('reads host facts over ssh and parses them', async () => {
        const adapter = new IosAdapter(options(makeShell({ 'laneHost.sh facts': FACTS }).shell));
        await expect(adapter.hostFacts()).resolves.toEqual({ cpus: 14, load1: 1.5, memAvailable: 40 });
    });

    it('refuses the host when the app for this tree is missing or stale, and never builds it itself', async () => {
        const shell: IosShell = {
            ...makeShell().shell,
            run: (_command, args) => {
                if (args.includes('check')) {
                    return Promise.reject(
                        new Error('buildIosApp: no test app for key abc. Build it: buildIosApp.sh build abc'),
                    );
                }

                return Promise.resolve(args.includes('content-key') ? 'abc\n' : '');
            },
        };
        const adapter = new IosAdapter(options(shell));
        await expect(adapter.prepareHost({ runId: 'r', stateDir: '/s', repoRoot: '/repo' })).rejects.toThrow(
            /Build it/,
        );
    });

    it('tunnels the origin ports the app was built with, back to the local services', async () => {
        const recorder = makeShell({ 'content-key': 'abc\n', 'testApp.manifest': MANIFEST });
        const adapter = new IosAdapter(options(recorder.shell));
        await adapter.prepareHost({ runId: 'r', stateDir: '/s', repoRoot: '/repo' });
        const tunnel = recorder.tunnels[0]?.join(' ') ?? '';
        expect(tunnel).toContain('-R 13000:localhost:3000');
        expect(tunnel).toContain('-R 13001:localhost:3001');
        expect(tunnel).toContain('-R 13002:localhost:3002');
    });

    it('tunnels to the recipe host port the local settings state when it has moved', async () => {
        const recorder = makeShell({ 'content-key': 'abc\n', 'testApp.manifest': MANIFEST });
        const moved = { ...SETTINGS, recipeOrigin: 'http://localhost:3010' };
        const adapter = new IosAdapter(options(recorder.shell, { LOCAL_MAESTRO_IOS_HOST: 'me@mac' }, moved));
        await adapter.prepareHost({ runId: 'r', stateDir: '/s', repoRoot: '/repo' });
        const tunnel = recorder.tunnels[0]?.join(' ') ?? '';
        expect(tunnel).toContain('-R 13000:localhost:3010');
        expect(tunnel).not.toContain('localhost:3000');
    });

    it('gives a lane its own simulator, boots it fresh and installs the checked app', async () => {
        const recorder = makeShell({
            'content-key': 'abc\n',
            'testApp.manifest': MANIFEST,
            'laneHost.sh ensure 2': 'UDID-2\n',
        });
        const adapter = new IosAdapter(options(recorder.shell));
        await adapter.prepareHost({ runId: 'r', stateDir: '/s', repoRoot: '/repo' });
        await adapter.startDevice({
            platform: 'ios',
            index: 2,
            count: 2,
            device: adapter.deviceFor(2),
            driverPort: 7002,
            stateDir: '/s/lanes/ios-2',
            fixtureEnvFile: '/s/lanes/ios-2/fixture.env',
        });
        const joined = recorder.commands.join('\n');
        expect(joined).toContain('laneHost.sh ensure 2');
        expect(joined).toContain('laneHost.sh erase UDID-2');
        expect(joined).toContain('laneHost.sh boot UDID-2');
        expect(joined).toContain('laneHost.sh install UDID-2 ksIos/apps/abc');
    });

    it('switches password AutoFill off on the booted Simulator through the runner own function, through the shims', async () => {
        const calls: { line: string; env: Record<string, string> | undefined }[] = [];
        const recorder = makeShell({ 'content-key': 'abc\n', 'testApp.manifest': MANIFEST, 'ensure 1': 'UDID-1\n' });
        const shell: IosShell = {
            ...recorder.shell,
            run: (command, args, env) => {
                calls.push({ line: [command, ...args].join(' '), env: env as Record<string, string> | undefined });

                return recorder.shell.run(command, args, env);
            },
        };
        const adapter = new IosAdapter(options(shell));
        await adapter.prepareHost({ runId: 'r', stateDir: '/s', repoRoot: '/repo' });
        await adapter.startDevice({
            platform: 'ios',
            index: 1,
            count: 1,
            device: adapter.deviceFor(1),
            driverPort: 7001,
            stateDir: '/s/lanes/ios-1',
            fixtureEnvFile: '/s/lanes/ios-1/fixture.env',
        });
        const call = calls.find((c) => c.line.includes('maestro_disable_password_autofill_ios'));
        expect(call?.line).toContain('/repo/packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh');
        expect(call?.env?.['MAESTRO_IOS_UDID']).toBe('UDID-1');
        expect(call?.env?.['PATH']?.startsWith('/s/shims:')).toBe(true);
    });

    it('hands the runner the lane Simulator, skips its own install and puts the shims first on PATH', async () => {
        const recorder = makeShell({ 'content-key': 'abc\n', 'testApp.manifest': MANIFEST, 'ensure 1': 'UDID-1\n' });
        const adapter = new IosAdapter(options(recorder.shell, { LOCAL_MAESTRO_IOS_HOST: 'me@mac', PATH: '/usr/bin' }));
        await adapter.prepareHost({ runId: 'r', stateDir: '/s', repoRoot: '/repo' });
        const lane = {
            platform: 'ios' as const,
            index: 1,
            count: 1,
            device: adapter.deviceFor(1),
            driverPort: 7001,
            stateDir: '/s/lanes/ios-1',
            fixtureEnvFile: '/s/lanes/ios-1/fixture.env',
        };
        await adapter.startDevice(lane);
        const env = adapter.laneEnv(lane);
        expect(env['MAESTRO_IOS_UDID']).toBe('UDID-1');
        expect(env['MAESTRO_SKIP_INSTALL']).toBe('1');
        expect(env['PATH']?.startsWith('/s/shims:')).toBe(true);
        expect(env['KS_MAC_LANE_HOME']).toContain('lane1');
    });

    it('answers an empty environment for a lane that has not started, because the orchestrator asks while provisioning users', () => {
        const adapter = new IosAdapter(options(makeShell().shell));
        const lane = {
            platform: 'ios' as const,
            index: 1,
            count: 1,
            device: adapter.deviceFor(1),
            driverPort: 7001,
            stateDir: '/s/lanes/ios-1',
            fixtureEnvFile: '/s/lanes/ios-1/fixture.env',
        };
        expect(adapter.laneEnv(lane)).toEqual({});
    });

    it('keeps the ssh control socket path short enough for a unix socket, however long the state folder is', async () => {
        const recorder = makeShell({ 'content-key': 'abc\n', 'testApp.manifest': MANIFEST });
        const adapter = new IosAdapter(options(recorder.shell));
        const stateDir = `/home/brandon/.local/state/kitchensink/localMaestro/${'run-'.repeat(12)}`;
        await adapter.prepareHost({ runId: 'r', stateDir, repoRoot: '/repo' });
        const config = recorder.files.get(`${stateDir}/ssh.conf`) ?? '';
        const controlPath = /ControlPath (\S+)/.exec(config)?.[1] ?? '';
        // ssh replaces %C with a 40 character hash; a unix socket path may hold at most 103 characters.
        expect(controlPath.replace('%C', 'x'.repeat(40)).length).toBeLessThanOrEqual(103);
    });

    it('stops the tunnel on teardown', async () => {
        const recorder = makeShell({ 'content-key': 'abc\n', 'testApp.manifest': MANIFEST });
        const adapter = new IosAdapter(options(recorder.shell));
        await adapter.prepareHost({ runId: 'r', stateDir: '/s', repoRoot: '/repo' });
        await adapter.teardownHost();
        expect(recorder.stopped).toBe(1);
    });
});
