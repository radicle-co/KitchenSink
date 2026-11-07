/**
 * The lane run, end to end over fakes: a fake device adapter, fake shared services, and a STUB runner script that
 * records the environment it was started with and exits with a code the test chooses. The real lane process code
 * spawns it, so the environment each lane is given and the exit code the run reports are what a real run would see.
 */
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { DeviceAdapter, LanePlatform, LaneSpec } from '../laneTypes.js';
import { runLaneRun, type LaneRunDeps } from '../laneRun.js';
import { spawnRunner } from '../laneProcess.js';
import type { SharedServices } from '../sharedServices.js';

const dirs: string[] = [];

afterEach(() => {
    for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/** A runner that writes its env to `<MAESTRO_FIXTURE_ENV_FILE>.env` and exits `EXIT_<index>` (default 0). */
function stubRunner(dir: string): string {
    const file = path.join(dir, 'runner.sh');
    writeFileSync(
        file,
        [
            '#!/usr/bin/env bash',
            'env | sort > "${MAESTRO_FIXTURE_ENV_FILE}.env"',
            'date +%s%N > "${MAESTRO_FIXTURE_ENV_FILE}.started"',
            'code_var="EXIT_${MAESTRO_SHARD_INDEX}"',
            'exit "${!code_var:-0}"',
            '',
        ].join('\n'),
    );
    chmodSync(file, 0o755);

    return file;
}

function fakeAdapter(events: string[], platform: LanePlatform = 'android'): DeviceAdapter {
    return {
        platform,
        laneCost: { cpus: 1, memBytes: 1 },
        maxLanes: 8,
        hostFacts: () => Promise.resolve({ cpus: 64, load1: 0, memAvailable: 1024 }),
        prepareHost: () => {
            events.push(`prepareHost ${platform}`);

            return Promise.resolve();
        },
        deviceFor: (index) => (platform === 'android' ? `emulator-${5554 + 2 * index}` : `ks-maestro-lane-${index}`),
        startDevice: (lane) => {
            events.push(`startDevice ${lane.platform}-${lane.index}`);

            return Promise.resolve();
        },
        laneEnv: (lane) => ({ ANDROID_SERIAL: lane.device, MAESTRO_SKIP_INSTALL: '1' }),
        stopDevice: (lane) => {
            events.push(`stopDevice ${lane.platform}-${lane.index}`);

            return Promise.resolve();
        },
        teardownHost: () => {
            events.push(`teardownHost ${platform}`);

            return Promise.resolve();
        },
    };
}

interface Harness {
    readonly events: string[];
    readonly state: string;
    readonly deps: LaneRunDeps;
}

function harness(overrides: Partial<LaneRunDeps> = {}, env: Readonly<Record<string, string>> = {}): Harness {
    const state = mkdtempSync(path.join(tmpdir(), 'laneRun-'));
    dirs.push(state);
    const events: string[] = [];
    const runner = stubRunner(state);
    const services: SharedServices = {
        resetLanes: (lanes) => {
            events.push(`resetLanes ${lanes.map((lane) => `${lane.platform}-${lane.index}`).join(',')}`);

            return Promise.resolve();
        },
        stop: (lanes) => {
            events.push(`stopServices ${lanes.map((lane) => `${lane.platform}-${lane.index}`).join(',')}`);

            return Promise.resolve();
        },
    };

    return {
        events,
        state,
        deps: {
            adapterFor: (platform) => fakeAdapter(events, platform),
            aborted: () => false,
            stateDir: state,
            repoRoot: state,
            lockDir: path.join(state, 'locks'),
            baseEnv: { PATH: process.env['PATH'] ?? '', KEEP: 'me', ...env },
            acquireLock: () => {
                events.push('lock');

                return {
                    release: () => {
                        events.push('unlock');
                    },
                };
            },
            selectFlows: () => Promise.resolve({ flows: ['a', 'b', 'c', 'd'], notes: [] }),
            pack: (_platform, index, count) =>
                Promise.resolve(['a', 'b', 'c', 'd'].filter((_, position) => position % count === index - 1)),
            identityCap: () => Promise.resolve(8),
            startServices: () => {
                events.push('startServices');

                return Promise.resolve(services);
            },
            createRunUsers: (platforms) => {
                events.push(`createRunUsers ${platforms.join(',')}`);

                return Promise.resolve();
            },
            removeRunUsers: (platforms) => {
                events.push(`removeRunUsers ${platforms.join(',')}`);

                return Promise.resolve();
            },
            setupLane: (lane) => {
                events.push(`setupLane ${lane.platform}-${lane.index}`);
                writeFileSync(lane.fixtureEnvFile, 'E2E_X=1\n');

                return Promise.resolve();
            },
            spawnLane: (lane, laneEnv) =>
                spawnRunner({ script: runner, cwd: state, env: laneEnv, log: path.join(lane.stateDir, 'runner.log') }),
            staggerMs: 50,
            log: (line) => events.push(`log ${line}`),
            ...overrides,
        },
    };
}

const envOf = (lane: LaneSpec | string): Readonly<Record<string, string>> =>
    Object.fromEntries(
        readFileSync(`${typeof lane === 'string' ? lane : lane.fixtureEnvFile}.env`, 'utf8')
            .split('\n')
            .filter((line) => line.includes('='))
            .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );

const laneFile = (state: string, index: number): string => path.join(state, 'lanes', `android-${index}`, 'fixture.env');

describe('runLaneRun — a lane run over fakes', () => {
    it('gives each lane its own shard, device, port, manifest, selector and the local contract', async () => {
        const { state, deps } = harness();

        expect(await runLaneRun(deps, { platforms: ['android'], requested: 2, selection: ['a', 'b'] })).toBe(0);

        for (const index of [1, 2]) {
            const env = envOf(laneFile(state, index));

            expect(env['MAESTRO_PLATFORM']).toBe('android');
            expect(env['MAESTRO_SHARD_INDEX']).toBe(String(index));
            expect(env['MAESTRO_SHARD_COUNT']).toBe('2');
            expect(env['COMMISE_E2E_SHARD']).toBe(String(index));
            expect(env['MAESTRO_DRIVER_PORT']).toBe(String(7000 + index));
            expect(env['MAESTRO_FIXTURE_ENV_FILE']).toBe(laneFile(state, index));
            expect(env['MAESTRO_FLOW_SELECTOR']).toBe('flow:a=true flow:b=true');
            expect(env['MAESTRO_LOCAL']).toBe('1');
            expect(env['MAESTRO_LOCK_DIR']).toBe(path.join(state, 'locks'));
            expect(env['ANDROID_SERIAL']).toBe(`emulator-${5554 + 2 * index}`);
            expect(env['E2E_SEED_STATE_DIR']).toBe(path.join(state, 'lanes', `android-${index}`));
            expect(env['E2E_POOL_NAMESPACE']).toBe('local');
            expect(env['E2E_ROLE_USERS_NAMESPACE']).toBe('shared');
            expect(env['KEEP']).toBe('me');
        }
    });

    it('runs the full suite as an empty selector', async () => {
        const { state, deps } = harness();

        await runLaneRun(deps, { platforms: ['android'], requested: 1, selection: 'all' });

        expect(envOf(laneFile(state, 1))['MAESTRO_FLOW_SELECTOR']).toBe('');
    });

    it('starts the lanes staggered', async () => {
        const { state, deps } = harness({ staggerMs: 300 });

        await runLaneRun(deps, { platforms: ['android'], requested: 2, selection: 'all' });

        const started = [1, 2].map((index) => Number(readFileSync(`${laneFile(state, index)}.started`, 'utf8')) / 1e6);
        expect((started[1] ?? 0) - (started[0] ?? 0)).toBeGreaterThanOrEqual(250);
    });

    it('exits with the worst lane code, and still tears everything down', async () => {
        const { events, deps } = harness({}, { EXIT_2: '3' });

        expect(await runLaneRun(deps, { platforms: ['android'], requested: 2, selection: 'all' })).toBe(3);
        expect(events.filter((event) => !event.startsWith('log'))).toEqual([
            'lock',
            'startServices',
            'createRunUsers android',
            'resetLanes android-1,android-2',
            'setupLane android-1',
            'setupLane android-2',
            'prepareHost android',
            'startDevice android-1',
            'startDevice android-2',
            'stopServices android-1,android-2',
            'removeRunUsers android',
            'stopDevice android-1',
            'stopDevice android-2',
            'teardownHost android',
            'unlock',
        ]);
    });

    it('starts no device, service or lane when nothing is selected, and passes', async () => {
        const { events, state, deps } = harness({
            selectFlows: () => Promise.resolve({ flows: [], notes: ['nothing local'] }),
        });

        expect(await runLaneRun(deps, { platforms: ['android'], requested: 2, selection: ['x'] })).toBe(0);
        expect(events.filter((event) => !event.startsWith('log'))).toEqual(['lock', 'unlock']);
        expect(readdirSync(state)).not.toContain('lanes');
    });

    it('lowers the lane count until every lane holds a flow, before any device boots', async () => {
        const { events, deps } = harness({
            selectFlows: () => Promise.resolve({ flows: ['p', 'q', 'r'], notes: [] }),
            pack: (_platform, index) => Promise.resolve(index === 1 ? ['p', 'q', 'r'] : []),
        });

        await runLaneRun(deps, { platforms: ['android'], requested: 3, selection: 'all' });

        expect(events.filter((event) => event.startsWith('startDevice'))).toEqual(['startDevice android-1']);
    });

    it('is bound by the lanes whose Clerk users exist', async () => {
        const { events, deps } = harness({ identityCap: () => Promise.resolve(1) });

        await runLaneRun(deps, { platforms: ['android'], selection: 'all' });

        expect(events.filter((event) => event.startsWith('startDevice'))).toEqual(['startDevice android-1']);
    });

    it('refuses, and starts nothing, when no lane has its Clerk users', async () => {
        const { events, deps } = harness({ identityCap: () => Promise.resolve(0) });

        await expect(runLaneRun(deps, { platforms: ['android'], selection: 'all' })).rejects.toThrow(
            /poolAdmin --apply/u,
        );
        expect(events.filter((event) => !event.startsWith('log'))).toEqual(['lock', 'unlock']);
    });

    it('stops services, devices and the lock when a device fails to start', async () => {
        const { events, deps } = harness();

        const adapterFor = (platform: LanePlatform): DeviceAdapter => {
            const base = deps.adapterFor(platform);

            return {
                ...base,
                startDevice: (lane) =>
                    lane.index === 2 ? Promise.reject(new Error('boot failed')) : base.startDevice(lane),
            };
        };

        await expect(
            runLaneRun({ ...deps, adapterFor }, { platforms: ['android'], requested: 2, selection: 'all' }),
        ).rejects.toThrow(/boot failed/u);
        expect(events).toContain('stopServices android-1,android-2');
        expect(events).toContain('stopDevice android-1');
        expect(events.at(-1)).toBe('unlock');
    });

    it('runs both platforms under ONE lock and ONE set of services, resetting every lane of both serially', async () => {
        const { events, state, deps } = harness();

        expect(await runLaneRun(deps, { platforms: ['android', 'ios'], requested: 2, selection: 'all' })).toBe(0);
        expect(events.filter((event) => event === 'lock' || event === 'startServices')).toEqual([
            'lock',
            'startServices',
        ]);
        expect(events).toContain('resetLanes android-1,android-2,ios-1,ios-2');
        expect(events).toContain('stopServices android-1,android-2,ios-1,ios-2');
        expect(envOf(path.join(state, 'lanes', 'ios-2', 'fixture.env'))['MAESTRO_PLATFORM']).toBe('ios');
        expect(events.at(-1)).toBe('unlock');
    });

    it('stops at the next phase when aborted, cleans up and exits 130', async () => {
        let setups = 0;
        const { events, deps } = harness();
        const aborting: LaneRunDeps = {
            ...deps,
            setupLane: async (lane, env) => {
                setups += 1;
                await deps.setupLane(lane, env);
            },
            aborted: () => setups >= 1,
        };

        expect(await runLaneRun(aborting, { platforms: ['android'], requested: 2, selection: 'all' })).toBe(130);
        expect(events.some((event) => event.startsWith('startDevice'))).toBe(false);
        expect(events).toContain('stopServices android-1,android-2');
        expect(events).toContain('removeRunUsers android');
        expect(events.at(-1)).toBe('unlock');
    });

    /**
     * Owner direction 2026-11-07: boot the emulators in parallel. Each device boots on its own console port and serial, so
     * a lane does not wait for the one before it; the platforms were already parallel.
     */
    it("boots a platform's devices at once, not one after another", async () => {
        const { events, deps } = harness();
        const adapterFor = (platform: LanePlatform): DeviceAdapter => ({
            ...deps.adapterFor(platform),
            startDevice: async (lane) => {
                events.push(`startDevice ${lane.platform}-${lane.index}`);
                await new Promise((resolve) => setTimeout(resolve, 100));
                events.push(`booted ${lane.platform}-${lane.index}`);
            },
        });

        await runLaneRun({ ...deps, adapterFor }, { platforms: ['android'], requested: 3, selection: 'all' });

        expect(events.filter((event) => /^(startDevice|booted) /u.test(event))).toEqual([
            'startDevice android-1',
            'startDevice android-2',
            'startDevice android-3',
            'booted android-1',
            'booted android-2',
            'booted android-3',
        ]);
    });

    it('waits for every boot to settle before it stops the devices when one fails, and stops all of them', async () => {
        const { events, deps } = harness();
        const adapterFor = (platform: LanePlatform): DeviceAdapter => ({
            ...deps.adapterFor(platform),
            startDevice: async (lane) => {
                events.push(`startDevice ${lane.platform}-${lane.index}`);

                if (lane.index === 1) {
                    throw new Error('boot failed');
                }

                await new Promise((resolve) => setTimeout(resolve, 100));
                events.push(`booted ${lane.platform}-${lane.index}`);
            },
        });

        await expect(
            runLaneRun({ ...deps, adapterFor }, { platforms: ['android'], requested: 2, selection: 'all' }),
        ).rejects.toThrow(/boot failed/u);
        expect(events.indexOf('booted android-2')).toBeLessThan(events.indexOf('stopDevice android-1'));
        expect(events).toContain('stopDevice android-2');
        expect(events.at(-1)).toBe('unlock');
    });
});

/**
 * Owner ruling 2026-11-07: a local erasure subject exists only during a run, and the run deletes the id it recorded. The run
 * makes its users once the services are up and before any lane leases them, and removes them after the services stop and
 * before the devices go, whatever failed.
 */
describe('runLaneRun — the run users', () => {
    it('makes them for every platform with lanes, once, and removes them for the same platforms', async () => {
        const { events, deps } = harness();

        expect(await runLaneRun(deps, { platforms: ['android', 'ios'], requested: 1, selection: 'all' })).toBe(0);
        expect(events.filter((event) => /RunUsers/u.test(event))).toEqual([
            'createRunUsers android,ios',
            'removeRunUsers android,ios',
        ]);
    });

    it('makes none, and removes none, when nothing runs', async () => {
        const { events, deps } = harness({ selectFlows: () => Promise.resolve({ flows: [], notes: [] }) });

        await runLaneRun(deps, { platforms: ['android'], selection: 'all' });

        expect(events.filter((event) => /RunUsers/u.test(event))).toEqual([]);
    });

    it('still removes them, stops the services and releases the lock when making them fails', async () => {
        const { events, deps } = harness();
        const failing: LaneRunDeps = {
            ...deps,
            createRunUsers: () => Promise.reject(new Error('subject already stands')),
        };

        await expect(runLaneRun(failing, { platforms: ['android'], requested: 2, selection: 'all' })).rejects.toThrow(
            /subject already stands/u,
        );
        expect(events.some((event) => event.startsWith('setupLane'))).toBe(false);
        expect(events.filter((event) => !event.startsWith('log')).slice(-3)).toEqual([
            'stopServices android-1,android-2',
            'removeRunUsers android',
            'unlock',
        ]);
    });

    it('still stops the devices and releases the lock when removing them fails, and reports it', async () => {
        const { events, deps } = harness();
        const failing: LaneRunDeps = {
            ...deps,
            removeRunUsers: () => Promise.reject(new Error('clerk down')),
        };

        await expect(runLaneRun(failing, { platforms: ['android'], requested: 2, selection: 'all' })).rejects.toThrow(
            /clerk down/u,
        );
        expect(events).toContain('stopDevice android-1');
        expect(events).toContain('stopDevice android-2');
        expect(events).toContain('teardownHost android');
        expect(events.at(-1)).toBe('unlock');
    });
});
