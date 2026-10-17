// @vitest-environment node
/**
 * The nightly stop never depends on the reclaim's SDK client (ADR-0061 security review, N6).
 *
 * The stop is the cost safety: it must stop the database, the NAT and every service whatever else is wrong. The reclaim
 * is an improvement on it. If the stop function imported `@aws-sdk/client-sfn` at the top of its module, a runtime
 * that failed to load that package would fail the WHOLE function at init, and nothing would stop. So the client is
 * imported lazily, inside `startLoop`, and a failure of that import is just another reclaim error.
 *
 * Here the package is made to throw on import, and the REAL handler and the REAL `runStop` run against fake ports.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { stops, ports } = vi.hoisted(() => {
    const calls = { rds: [] as string[], ecs: [] as number[], ec2: [] as string[] };

    return {
        stops: calls,
        ports: {
            rds: {
                listInstances: async () => [{ identifier: 'kitchensink-data-sandbox', status: 'available' }],
                stopInstance: async (id: string) => {
                    calls.rds.push(id);
                },
                startInstance: async () => undefined,
            },
            ecs: {
                listClusters: async () => [
                    {
                        arn: 'arn:aws:ecs:us-east-1:1:cluster/kitchensink-identity-service-sandbox-C',
                        environmentTag: 'sandbox',
                    },
                ],
                listServices: async (clusterArn: string) => [
                    { clusterArn, serviceArn: `${clusterArn}/identity`, serviceName: 'identity', desiredCount: 1 },
                ],
                updateDesiredCount: async (_cluster: string, _service: string, count: number) => {
                    calls.ecs.push(count);
                },
            },
            ec2: {
                listInstances: async () => [
                    {
                        instanceId: 'i-nat',
                        state: 'running',
                        nameTag: 'Global-sandbox/Network-sandbox/Vpc/publicSubnet1/NatInstance',
                        stackNameTag: 'kitchensink-network-sandbox',
                        sourceDestCheck: false,
                    },
                ],
                stopInstances: async (ids: string[]) => {
                    calls.ec2.push(...ids);
                },
                startInstances: async () => undefined,
            },
            ssm: { getParameter: async () => undefined, putParameter: async () => undefined },
            events: {
                listScheduledRules: async () => [],
                enableRule: async () => undefined,
                disableRule: async () => undefined,
            },
        },
    };
});

// The package fails to load, as it would on a runtime that does not provide it.
vi.mock('@aws-sdk/client-sfn', () => {
    throw new Error("Cannot find package '@aws-sdk/client-sfn'");
});

vi.mock('../src/observability/silentNoOp.js', () => ({ announceSilentNoOp: vi.fn(async () => true) }));

vi.mock('../src/sandbox-scheduler/awsAdapters.js', () => ({
    createRdsApi: () => ports.rds,
    createEcsApi: () => ports.ecs,
    createEc2Api: () => ports.ec2,
    createSsmApi: () => ports.ssm,
    createEventsApi: () => ports.events,
}));

const { handler } = await import('../src/sandbox-scheduler/handler.js');

beforeEach(() => {
    stops.rds.length = 0;
    stops.ecs.length = 0;
    stops.ec2.length = 0;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('⛔ the stop does not depend on the reclaim`s SDK client', () => {
    it('loads the handler at all although @aws-sdk/client-sfn cannot be imported', () => {
        expect(typeof handler).toBe('function');
    });

    it('still stops the database, the services and the NAT when that import fails, and fails the run afterwards', async () => {
        process.env['RECLAIM_STATE_MACHINE_ARN'] = 'arn:aws:states:us-east-1:1:stateMachine:reclaim';

        await expect(handler({ action: 'stop', scheduledTime: '2026-10-13T04:00:00Z' })).rejects.toThrow(
            /reclaim start nightly-2026-10-13T04-00-00Z/u,
        );

        expect(stops.rds).toEqual(['kitchensink-data-sandbox']);
        expect(stops.ecs).toEqual([0]);
        expect(stops.ec2).toEqual(['i-nat']);
    });

    it('still stops everything when no reclaim is configured, and says why the run failed', async () => {
        delete process.env['RECLAIM_STATE_MACHINE_ARN'];

        await expect(handler({ action: 'stop', scheduledTime: '2026-10-13T04:00:00Z' })).rejects.toThrow(
            /RECLAIM_STATE_MACHINE_ARN/u,
        );

        expect(stops.rds).toEqual(['kitchensink-data-sandbox']);
        expect(stops.ecs).toEqual([0]);
        expect(stops.ec2).toEqual(['i-nat']);
    });
});
