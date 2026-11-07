/**
 * The lane run, end to end over fakes: a fake device adapter, fake shared services, and a STUB runner script that
 * records the environment it was started with and exits with a code the test chooses. The real lane process code
 * spawns it, so the environment each lane is given and the exit code the run reports are what a real run would see.
 */
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { DeviceAdapter, LaneSpec } from '../laneTypes.js';
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

function fakeAdapter(events: string[]): DeviceAdapter {
    return {
        platform: 'android',
        laneCost: { cpus: 1, memBytes: 1 },
        maxLanes: 8,
        hostFacts: () => Promise.resolve({ cpus: 64, load1: 0, memAvailable: 1024 }),
        prepareHost: () => {
            events.push('prepareHost');

            return Promise.resolve();
        },
        deviceFor: (index) => `emulator-${5554 + 2 * index}`,
        startDevice: (lane) => {
            events.push(`startDevice ${lane.index}`);

            return Promise.resolve();
        },
        laneEnv: (lane) => ({ ANDROID_SERIAL: lane.device, MAESTRO_SKIP_INSTALL: '1' }),
        stopDevice: (lane) => {
            events.push(`stopDevice ${lane.index}`);

            return Promise.resolve();
        },
        teardownHost: () => {
            events.push('teardownHost');

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
            events.push(`resetLanes ${lanes.map((lane) => lane.index).join(',')}`);

            return Promise.resolve();
        },
        stop: (lanes) => {
            events.push(`stopServices ${lanes.map((lane) => lane.index).join(',')}`);

            return Promise.resolve();
        },
    };

    return {
        events,
        state,
        deps: {
            adapter: fakeAdapter(events),
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
            pack: (index, count) =>
                Promise.resolve(['a', 'b', 'c', 'd'].filter((_, position) => position % count === index - 1)),
            identityCap: () => Promise.resolve(8),
            startServices: () => {
                events.push('startServices');

                return Promise.resolve(services);
            },
            setupLane: (lane) => {
                events.push(`setupLane ${lane.index}`);
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

        expect(await runLaneRun(deps, { platform: 'android', requested: 2, selection: ['a', 'b'] })).toBe(0);

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

        await runLaneRun(deps, { platform: 'android', requested: 1, selection: 'all' });

        expect(envOf(laneFile(state, 1))['MAESTRO_FLOW_SELECTOR']).toBe('');
    });

    it('starts the lanes staggered', async () => {
        const { state, deps } = harness({ staggerMs: 300 });

        await runLaneRun(deps, { platform: 'android', requested: 2, selection: 'all' });

        const started = [1, 2].map((index) => Number(readFileSync(`${laneFile(state, index)}.started`, 'utf8')) / 1e6);
        expect((started[1] ?? 0) - (started[0] ?? 0)).toBeGreaterThanOrEqual(250);
    });

    it('exits with the worst lane code, and still tears everything down', async () => {
        const { events, deps } = harness({}, { EXIT_2: '3' });

        expect(await runLaneRun(deps, { platform: 'android', requested: 2, selection: 'all' })).toBe(3);
        expect(events.filter((event) => !event.startsWith('log'))).toEqual([
            'lock',
            'startServices',
            'resetLanes 1,2',
            'setupLane 1',
            'setupLane 2',
            'prepareHost',
            'startDevice 1',
            'startDevice 2',
            'stopServices 1,2',
            'stopDevice 1',
            'stopDevice 2',
            'teardownHost',
            'unlock',
        ]);
    });

    it('starts no device, service or lane when nothing is selected, and passes', async () => {
        const { events, state, deps } = harness({
            selectFlows: () => Promise.resolve({ flows: [], notes: ['nothing local'] }),
        });

        expect(await runLaneRun(deps, { platform: 'android', requested: 2, selection: ['x'] })).toBe(0);
        expect(events.filter((event) => !event.startsWith('log'))).toEqual(['lock', 'unlock']);
        expect(readdirSync(state)).not.toContain('lanes');
    });

    it('lowers the lane count until every lane holds a flow, before any device boots', async () => {
        const { events, deps } = harness({
            selectFlows: () => Promise.resolve({ flows: ['p', 'q', 'r'], notes: [] }),
            pack: (index) => Promise.resolve(index === 1 ? ['p', 'q', 'r'] : []),
        });

        await runLaneRun(deps, { platform: 'android', requested: 3, selection: 'all' });

        expect(events.filter((event) => event.startsWith('startDevice'))).toEqual(['startDevice 1']);
    });

    it('is bound by the lanes whose Clerk users exist', async () => {
        const { events, deps } = harness({ identityCap: () => Promise.resolve(1) });

        await runLaneRun(deps, { platform: 'android', selection: 'all' });

        expect(events.filter((event) => event.startsWith('startDevice'))).toEqual(['startDevice 1']);
    });

    it('fails, and starts no lane, when no lane has its Clerk users', async () => {
        const { events, deps } = harness({ identityCap: () => Promise.resolve(0) });

        expect(await runLaneRun(deps, { platform: 'android', selection: 'all' })).toBe(1);
        expect(events.some((event) => event.startsWith('startDevice'))).toBe(false);
        expect(events.at(-1)).toBe('unlock');
    });

    it('stops services, devices and the lock when a device fails to start', async () => {
        const harnessed = harness();
        const { events, deps } = harnessed;
        const adapter: DeviceAdapter = {
            ...deps.adapter,
            startDevice: (lane) =>
                lane.index === 2 ? Promise.reject(new Error('boot failed')) : deps.adapter.startDevice(lane),
        };

        await expect(
            runLaneRun({ ...deps, adapter }, { platform: 'android', requested: 2, selection: 'all' }),
        ).rejects.toThrow(/boot failed/u);
        expect(events).toContain('stopServices 1,2');
        expect(events).toContain('stopDevice 1');
        expect(events.at(-1)).toBe('unlock');
    });
});
