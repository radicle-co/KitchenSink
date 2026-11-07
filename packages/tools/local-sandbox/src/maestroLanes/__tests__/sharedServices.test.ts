import { describe, expect, it } from 'vitest';

import type { LaneSpec } from '../laneTypes.js';
import { isForeignServiceError, startSharedServices, type ServicePorts, type ServiceSpec } from '../sharedServices.js';

const lane = (index: number): LaneSpec => ({
    platform: 'android',
    index,
    count: 2,
    device: `emulator-${5554 + 2 * index}`,
    driverPort: 7000 + index,
    stateDir: `/s/lanes/android-${index}`,
    fixtureEnvFile: `/s/lanes/android-${index}/fixture.env`,
});

const SPECS: readonly ServiceSpec[] = [
    { name: 'accountErasure', pattern: /bin\/queueConsumer\.ts accountErasure( |$)/u, command: 'npx', args: [] },
    { name: 'parseWorker', pattern: /src\/local\/main\.ts/u, command: 'npm', args: [] },
];

/** Fake ports that record every call, in order. */
function fakePorts(running: readonly { pid: number; command: string }[] = [], failReset: readonly number[] = []) {
    const events: string[] = [];
    const ports: ServicePorts = {
        listProcesses: () => Promise.resolve(running),
        start: (spec) => {
            events.push(`start ${spec.name}`);

            return Promise.resolve({
                pid: 1000 + events.length,
                stop: () => {
                    events.push(`stop ${spec.name}`);

                    return Promise.resolve();
                },
            });
        },
        resetPool: (target) => {
            events.push(`reset ${target.index}`);

            return failReset.includes(target.index)
                ? Promise.reject(new Error(`lane ${target.index} reset failed`))
                : Promise.resolve();
        },
    };

    return { events, ports };
}

describe('startSharedServices — the run owns every shared service it uses', () => {
    it('starts each service once', async () => {
        const { events, ports } = fakePorts();

        await startSharedServices(SPECS, ports);

        expect(events).toEqual(['start accountErasure', 'start parseWorker']);
    });

    it('refuses a service it did not start, names its pid, and starts nothing', async () => {
        const { events, ports } = fakePorts([
            { pid: 4242, command: 'node /x/tsx packages/tools/local-sandbox/bin/queueConsumer.ts accountErasure' },
        ]);

        const outcome = await startSharedServices(SPECS, ports).catch((error: unknown) => error);

        expect(isForeignServiceError(outcome)).toBe(true);
        expect(String(outcome)).toMatch(/4242/u);
        expect(events).toEqual([]);
    });

    it('does not mistake an unrelated process for a service', async () => {
        const { events, ports } = fakePorts([{ pid: 7, command: 'node bin/queueConsumer.ts accountErasureArchive' }]);

        await startSharedServices(SPECS, ports);

        expect(events).toEqual(['start accountErasure', 'start parseWorker']);
    });

    it('stops what it started when a later start fails', async () => {
        const { events, ports } = fakePorts();
        const failing: ServicePorts = {
            ...ports,
            start: (spec) =>
                spec.name === 'parseWorker' ? Promise.reject(new Error('worker died')) : ports.start(spec),
        };

        await expect(startSharedServices(SPECS, failing)).rejects.toThrow(/worker died/u);
        expect(events).toEqual(['start accountErasure', 'stop accountErasure']);
    });
});

describe('the pool resets — one lane after another, while the services are up', () => {
    it('resets every lane serially', async () => {
        const { events, ports } = fakePorts();
        const services = await startSharedServices(SPECS, ports);

        await services.resetLanes([lane(1), lane(2)]);

        expect(events.slice(2)).toEqual(['reset 1', 'reset 2']);
    });

    it('⛔ teardown resets every lane BEFORE any service stops', async () => {
        const { events, ports } = fakePorts();
        const services = await startSharedServices(SPECS, ports);

        await services.stop([lane(1), lane(2)]);

        expect(events.slice(2)).toEqual(['reset 1', 'reset 2', 'stop parseWorker', 'stop accountErasure']);
    });

    it('still resets the other lanes and stops every service when one reset fails, then reports it', async () => {
        const { events, ports } = fakePorts([], [1]);
        const services = await startSharedServices(SPECS, ports);

        await expect(services.stop([lane(1), lane(2)])).rejects.toThrow(/lane 1 reset failed/u);
        expect(events.slice(2)).toEqual(['reset 1', 'reset 2', 'stop parseWorker', 'stop accountErasure']);
    });

    it('stops once, however often it is asked', async () => {
        const { events, ports } = fakePorts();
        const services = await startSharedServices(SPECS, ports);

        await services.stop([lane(1)]);
        await services.stop([lane(1)]);

        expect(events.filter((event) => event.startsWith('stop'))).toEqual(['stop parseWorker', 'stop accountErasure']);
    });
});
