/**
 * The lane run, end to end over fakes: a fake device adapter, fake shared services, and a STUB runner script that
 * records the environment it was started with and exits with a code the test chooses. The real lane process code
 * spawns it, so the environment each lane is given and the exit code the run reports are what a real run would see.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

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
            runStamp: 'run1',
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
            selectFlows: () => Promise.resolve({ flows: ['a', 'b', 'c', 'd'], notes: [], owed: [] }),
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
            checkScreens: () => Promise.resolve({ code: 0, results: new Map() }),
            settleStamp: () => Promise.resolve(),
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

    it('tells each lane where to record the screens it shows', async () => {
        const { state, deps } = harness();

        await runLaneRun(deps, { platforms: ['android'], requested: 2, selection: 'all' });

        for (const index of [1, 2]) {
            expect(envOf(laneFile(state, index))['MAESTRO_SCREEN_RECORD']).toBe(
                path.join(state, 'lanes', `android-${index}`, 'screenRecord.tsv'),
            );
        }
    });

    it("tells each lane where to keep a failed flow's debug folder, one folder per run", async () => {
        const { state, deps } = harness();

        await runLaneRun(deps, { platforms: ['android'], requested: 2, selection: 'all' });

        for (const index of [1, 2]) {
            expect(envOf(laneFile(state, index))['MAESTRO_EVIDENCE_DIR']).toBe(
                path.join(state, 'lanes', `android-${index}`, 'failed', 'run1'),
            );
        }
    });

    it('prunes the lane failure folders of earlier runs to the newest five before the lanes start', async () => {
        const { state, deps } = harness();
        const failed = path.join(state, 'lanes', 'android-1', 'failed');

        for (const stamp of ['1', '2', '3', '4', '5', '6', '7']) {
            mkdirSync(path.join(failed, stamp), { recursive: true });
        }

        await runLaneRun(deps, { platforms: ['android'], requested: 1, selection: 'all' });

        expect(readdirSync(failed).sort()).toEqual(['3', '4', '5', '6', '7']);
    });

    it('⛔ starts no device and no lane when a slot cannot be reset, and reports the reset as the failure', async () => {
        const { events, deps } = harness({
            startServices: () =>
                Promise.resolve({
                    resetLanes: () => Promise.reject(new Error('slot ioscoauthor01 could not be reset')),
                    stop: (lanes) => {
                        events.push(`stopServices ${lanes.map((lane) => `${lane.platform}-${lane.index}`).join(',')}`);

                        return Promise.resolve();
                    },
                }),
        });

        await expect(runLaneRun(deps, { platforms: ['android'], requested: 2, selection: 'all' })).rejects.toThrow(
            'slot ioscoauthor01 could not be reset',
        );
        expect(events.filter((event) => /^(setupLane|startDevice|prepareHost)/u.test(event))).toEqual([]);
        expect(events).toContain('stopServices android-1,android-2');
        expect(events).toContain('unlock');
    });

    it('runs the full suite as an empty selector', async () => {
        const { state, deps } = harness();

        await runLaneRun(deps, { platforms: ['android'], requested: 1, selection: 'all' });

        expect(envOf(laneFile(state, 1))['MAESTRO_FLOW_SELECTOR']).toBe('');
    });

    /**
     * The run controls one thing here: when it CALLS `spawnLane`. This test pins that each call comes no earlier than
     * `staggerMs` after the one before it, on a fake clock. It used to read a timestamp each stub runner wrote after
     * its own bash start-up, which added the two children's start-up difference to the gap and failed CI (#202).
     */
    it('starts each lane no earlier than the stagger after the lane before it', async () => {
        const staggerMs = 300;
        const spawnedAt: number[] = [];
        const { deps } = harness({
            staggerMs,
            spawnLane: () => {
                spawnedAt.push(Date.now());

                return { pid: 0, exit: Promise.resolve(0), stop: () => undefined };
            },
        });
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

        try {
            const run = runLaneRun(deps, { platforms: ['android'], requested: 3, selection: 'all' });

            await vi.advanceTimersByTimeAsync(0);
            expect(spawnedAt, 'the first lane starts at once').toHaveLength(1);

            for (const lanes of [2, 3]) {
                await vi.advanceTimersByTimeAsync(staggerMs - 1);
                expect(spawnedAt, `lane ${lanes} must wait the whole stagger`).toHaveLength(lanes - 1);

                await vi.advanceTimersByTimeAsync(1);
                expect(spawnedAt, `lane ${lanes} starts once the stagger has passed`).toHaveLength(lanes);
            }

            expect(await run).toBe(0);

            const first = spawnedAt[0] ?? Number.NaN;

            for (const [lane, at] of spawnedAt.entries()) {
                expect(at - first, `lane ${lane} after lane 0`).toBeGreaterThanOrEqual(lane * staggerMs);
            }
        } finally {
            vi.useRealTimers();
        }
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
            selectFlows: () => Promise.resolve({ flows: [], notes: ['nothing local'], owed: [] }),
        });

        expect(await runLaneRun(deps, { platforms: ['android'], requested: 2, selection: ['x'] })).toBe(0);
        expect(events.filter((event) => !event.startsWith('log'))).toEqual(['lock', 'unlock']);
        expect(readdirSync(state)).not.toContain('lanes');
    });

    it('lowers the lane count until every lane holds a flow, before any device boots', async () => {
        const { events, deps } = harness({
            selectFlows: () => Promise.resolve({ flows: ['p', 'q', 'r'], notes: [], owed: [] }),
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
        const { events, deps } = harness({ selectFlows: () => Promise.resolve({ flows: [], notes: [], owed: [] }) });

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

describe('runLaneRun — the screen check folds into the exit code', () => {
    it('hands the check every lane, after the lanes exit', async () => {
        const seen: string[][] = [];
        const { deps } = harness({
            checkScreens: (lanes) => {
                seen.push(lanes.map((lane) => `${lane.platform}-${lane.index}`));

                return Promise.resolve({ code: 0, results: new Map() });
            },
        });

        await runLaneRun(deps, { platforms: ['android'], requested: 2, selection: 'all' });

        expect(seen).toEqual([['android-1', 'android-2']]);
    });

    it('fails a run whose lanes all passed when the check fails', async () => {
        const { deps } = harness({ checkScreens: () => Promise.resolve({ code: 1, results: new Map() }) });

        expect(await runLaneRun(deps, { platforms: ['android'], requested: 2, selection: 'all' })).toBe(1);
    });

    it('keeps the worst lane code when it is worse than the check', async () => {
        const { deps } = harness(
            { checkScreens: () => Promise.resolve({ code: 1, results: new Map() }) },
            { EXIT_2: '3' },
        );

        expect(await runLaneRun(deps, { platforms: ['android'], requested: 2, selection: 'all' })).toBe(3);
    });

    it('still tears everything down when the check throws, and reports the throw', async () => {
        const { events, deps } = harness({
            checkScreens: () => Promise.reject(new Error('damaged record')),
        });

        await expect(runLaneRun(deps, { platforms: ['android'], requested: 1, selection: 'all' })).rejects.toThrow(
            'damaged record',
        );
        expect(events).toContain('stopDevice android-1');
        expect(events).toContain('unlock');
    });

    it('does not run the check for a run the operator stopped', async () => {
        let calls = 0;
        let stopped = false;
        const { deps } = harness({
            aborted: () => stopped,
            checkScreens: () => {
                calls += 1;

                return Promise.resolve({ code: 1, results: new Map() });
            },
            spawnLane: (lane, env) => {
                stopped = true;

                return spawnRunner({ script: '/bin/true', cwd: '/', env, log: path.join(lane.stateDir, 'runner.log') });
            },
        });

        expect(await runLaneRun(deps, { platforms: ['android'], requested: 1, selection: 'all' })).toBe(130);
        expect(calls).toBe(0);
    });
});

describe('runLaneRun — a selection per platform', () => {
    const selectorOf = (state: string, platform: string): string =>
        envOf(path.join(state, 'lanes', `${platform}-1`, 'fixture.env'))['MAESTRO_FLOW_SELECTOR'] ?? 'missing';

    it('gives each platform its own flows', async () => {
        const { state, deps } = harness();

        await runLaneRun(deps, {
            platforms: ['android', 'ios'],
            requested: 1,
            selection: { android: ['a'], ios: 'all' },
        });

        expect(selectorOf(state, 'android')).toBe('flow:a=true');
        expect(selectorOf(state, 'ios')).toBe('');
    });

    it('starts nothing on a platform whose selection is empty, and does not read an empty list as every flow', async () => {
        const { events, state, deps } = harness();

        await runLaneRun(deps, { platforms: ['android', 'ios'], requested: 1, selection: { android: [], ios: ['b'] } });

        expect(events).not.toContain('startDevice android-1');
        expect(events).toContain('startDevice ios-1');
        expect(selectorOf(state, 'ios')).toBe('flow:b=true');
    });
});

describe('runLaneRun — the green stamp settles after the check', () => {
    const results = new Map([
        [
            'android',
            new Map([
                ['a', 'passed'],
                ['b', 'failed'],
            ] as const),
        ],
    ]);

    it('hands each planned platform its flows, what the sandbox-only drop owes, the results and the check verdict', async () => {
        const settled: unknown[] = [];
        const { deps } = harness({
            selectFlows: () => Promise.resolve({ flows: ['a', 'b'], notes: [], owed: ['spine'] }),
            pack: () => Promise.resolve(['a', 'b']),
            checkScreens: () => Promise.resolve({ code: 1, results }),
            settleStamp: (input) => {
                settled.push(input);

                return Promise.resolve();
            },
        });

        await runLaneRun(deps, { platforms: ['android'], requested: 1, selection: 'all' });

        expect(settled).toEqual([
            {
                platform: 'android',
                flows: ['a', 'b'],
                owed: ['spine'],
                results: results.get('android'),
                recorderClean: false,
            },
        ]);
    });

    it('settles a platform that had nothing to run, with no flows: an empty selection is a pass of nothing', async () => {
        const settled: { platform: string; flows: readonly string[] }[] = [];
        const { deps } = harness({
            selectFlows: () => Promise.resolve({ flows: [], notes: [], owed: ['spine'] }),
            settleStamp: (input) => {
                settled.push(input);

                return Promise.resolve();
            },
        });

        await runLaneRun(deps, { platforms: ['android'], selection: 'all' });

        expect(settled).toMatchObject([{ platform: 'android', flows: [] }]);
    });

    it('settles nothing for a run the operator stopped', async () => {
        let calls = 0;
        const { deps } = harness({
            aborted: () => true,
            settleStamp: () => {
                calls += 1;

                return Promise.resolve();
            },
        });

        await runLaneRun(deps, { platforms: ['android'], selection: 'all' });

        expect(calls).toBe(0);
    });
});
