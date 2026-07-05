/**
 * ADR-0007 sandbox scheduler decision logic: selects ONLY sandbox resources (prod is never targeted),
 * persists ECS desired counts on stop, and restores them from the stored value on start (never a
 * hardcoded count). Skips resources already in the target state.
 */
import { describe, it, expect } from 'vitest';

import {
    isSandboxClusterArn,
    isSandboxRdsInstance,
    priorCountParamName,
    runSchedulerAction,
    selectRdsTargets,
    selectSandboxNatInstances,
    type Ec2InstanceSummary,
    type EcsServiceSummary,
    type RdsInstanceSummary,
    type SchedulerClients,
} from '../lib/sandbox-scheduler/scheduler.js';

/** A recording fake set of clients for orchestration tests. */
interface FakeState {
    readonly rdsInstances: RdsInstanceSummary[];
    readonly clusters: string[];
    readonly services: EcsServiceSummary[];
    readonly ec2: Ec2InstanceSummary[];
    readonly ssm: Map<string, string>;
    readonly calls: {
        rdsStop: string[];
        rdsStart: string[];
        ecsUpdate: Array<{ service: string; desiredCount: number }>;
        ec2Stop: string[];
        ec2Start: string[];
    };
}

function makeClients(state: FakeState): SchedulerClients {
    return {
        rds: {
            listInstances: async () => state.rdsInstances,
            stopInstance: async (id) => {
                state.calls.rdsStop.push(id);
            },
            startInstance: async (id) => {
                state.calls.rdsStart.push(id);
            },
        },
        ecs: {
            listClusterArns: async () => state.clusters,
            listServices: async (clusterArn) => state.services.filter((s) => s.clusterArn === clusterArn),
            updateDesiredCount: async (_clusterArn, serviceArn, desiredCount) => {
                state.calls.ecsUpdate.push({ service: serviceArn, desiredCount });
            },
        },
        ec2: {
            listInstances: async () => state.ec2,
            stopInstances: async (ids) => {
                state.calls.ec2Stop.push(...ids);
            },
            startInstances: async (ids) => {
                state.calls.ec2Start.push(...ids);
            },
        },
        ssm: {
            getParameter: async (name) => state.ssm.get(name),
            putParameter: async (name, value) => {
                state.ssm.set(name, value);
            },
        },
    };
}

const SANDBOX_CLUSTER = 'arn:aws:ecs:us-east-1:111:cluster/kitchensink-food-service-sandbox-Cluster';
const PROD_CLUSTER = 'arn:aws:ecs:us-east-1:111:cluster/kitchensink-food-service-prod-Cluster';
const SANDBOX_SERVICE = `arn:aws:ecs:us-east-1:111:service/${SANDBOX_CLUSTER.split('/').pop()}/food-api`;

describe('resource selectors (sandbox-only)', () => {
    it('matches only -sandbox RDS instances', () => {
        expect(isSandboxRdsInstance('kitchensink-data-sandbox')).toBe(true);
        expect(isSandboxRdsInstance('kitchensink-data-prod')).toBe(false);
    });

    it('selects RDS by required state per action (skips instances mid-modifying)', () => {
        const instances: RdsInstanceSummary[] = [
            { identifier: 'kitchensink-data-sandbox', status: 'available' },
            { identifier: 'kitchensink-data-prod', status: 'available' },
            { identifier: 'kitchensink-other-sandbox', status: 'modifying' },
        ];

        expect(selectRdsTargets(instances, 'stop')).toEqual(['kitchensink-data-sandbox']);
        expect(selectRdsTargets(instances, 'start')).toEqual([]);
        expect(selectRdsTargets([{ identifier: 'kitchensink-data-sandbox', status: 'stopped' }], 'start')).toEqual([
            'kitchensink-data-sandbox',
        ]);
    });

    it('matches only sandbox cluster ARNs', () => {
        expect(isSandboxClusterArn(SANDBOX_CLUSTER)).toBe(true);
        expect(isSandboxClusterArn(PROD_CLUSTER)).toBe(false);
    });

    it('selects only the sandbox NAT instance (source/dest check disabled + sandbox Name tag)', () => {
        const instances: Ec2InstanceSummary[] = [
            {
                instanceId: 'i-sbx-nat',
                state: 'running',
                nameTag: 'kitchensink-network-sandbox/Vpc',
                sourceDestCheck: false,
            },
            {
                instanceId: 'i-prod-nat',
                state: 'running',
                nameTag: 'kitchensink-network-prod/Vpc',
                sourceDestCheck: false,
            },
            { instanceId: 'i-sbx-app', state: 'running', nameTag: 'sandbox-app', sourceDestCheck: true },
        ];

        expect(selectSandboxNatInstances(instances, 'stop')).toEqual(['i-sbx-nat']);
        expect(selectSandboxNatInstances(instances, 'start')).toEqual([]);
    });

    it('derives a stable per-service SSM parameter name', () => {
        expect(priorCountParamName(SANDBOX_SERVICE)).toBe(
            `/kitchensink/sandbox-scheduler/ecs/${SANDBOX_CLUSTER.split('/').pop()}/food-api`,
        );
    });
});

describe('runSchedulerAction — stop', () => {
    it('stops sandbox RDS + NAT, and persists-then-zeroes sandbox ECS desired counts (prod untouched)', async () => {
        const state: FakeState = {
            rdsInstances: [
                { identifier: 'kitchensink-data-sandbox', status: 'available' },
                { identifier: 'kitchensink-data-prod', status: 'available' },
            ],
            clusters: [SANDBOX_CLUSTER, PROD_CLUSTER],
            services: [
                { clusterArn: SANDBOX_CLUSTER, serviceArn: SANDBOX_SERVICE, serviceName: 'food-api', desiredCount: 3 },
                {
                    clusterArn: PROD_CLUSTER,
                    serviceArn: 'arn:aws:ecs:us-east-1:111:service/prod/identity',
                    serviceName: 'identity',
                    desiredCount: 2,
                },
            ],
            ec2: [{ instanceId: 'i-sbx-nat', state: 'running', nameTag: 'net-sandbox', sourceDestCheck: false }],
            ssm: new Map(),
            calls: { rdsStop: [], rdsStart: [], ecsUpdate: [], ec2Stop: [], ec2Start: [] },
        };
        const summary = await runSchedulerAction('stop', makeClients(state));

        expect(state.calls.rdsStop).toEqual(['kitchensink-data-sandbox']);
        expect(state.calls.ec2Stop).toEqual(['i-sbx-nat']);
        // Only the sandbox service was scaled to 0 — prod identity is never listed (non-sandbox cluster).
        expect(state.calls.ecsUpdate).toEqual([{ service: SANDBOX_SERVICE, desiredCount: 0 }]);
        // Prior count 3 persisted for the restore.
        expect(state.ssm.get(priorCountParamName(SANDBOX_SERVICE))).toBe('3');
        expect(summary.errors).toEqual([]);
    });

    it('skips an ECS service already scaled to zero', async () => {
        const state: FakeState = {
            rdsInstances: [],
            clusters: [SANDBOX_CLUSTER],
            services: [
                { clusterArn: SANDBOX_CLUSTER, serviceArn: SANDBOX_SERVICE, serviceName: 'food-api', desiredCount: 0 },
            ],
            ec2: [],
            ssm: new Map(),
            calls: { rdsStop: [], rdsStart: [], ecsUpdate: [], ec2Stop: [], ec2Start: [] },
        };
        const summary = await runSchedulerAction('stop', makeClients(state));

        expect(state.calls.ecsUpdate).toEqual([]);
        expect(summary.ecs.skipped).toEqual([SANDBOX_SERVICE]);
    });
});

describe('runSchedulerAction — start', () => {
    it('restores ECS to the STORED prior desired count (never a hardcoded 1)', async () => {
        const state: FakeState = {
            rdsInstances: [{ identifier: 'kitchensink-data-sandbox', status: 'stopped' }],
            clusters: [SANDBOX_CLUSTER],
            services: [
                { clusterArn: SANDBOX_CLUSTER, serviceArn: SANDBOX_SERVICE, serviceName: 'food-api', desiredCount: 0 },
            ],
            ec2: [{ instanceId: 'i-sbx-nat', state: 'stopped', nameTag: 'net-sandbox', sourceDestCheck: false }],
            ssm: new Map([[priorCountParamName(SANDBOX_SERVICE), '3']]),
            calls: { rdsStop: [], rdsStart: [], ecsUpdate: [], ec2Stop: [], ec2Start: [] },
        };
        const summary = await runSchedulerAction('start', makeClients(state));

        expect(state.calls.rdsStart).toEqual(['kitchensink-data-sandbox']);
        expect(state.calls.ec2Start).toEqual(['i-sbx-nat']);
        expect(state.calls.ecsUpdate).toEqual([{ service: SANDBOX_SERVICE, desiredCount: 3 }]);
        expect(summary.errors).toEqual([]);
    });

    it('skips a service with no stored prior count instead of guessing one', async () => {
        const state: FakeState = {
            rdsInstances: [],
            clusters: [SANDBOX_CLUSTER],
            services: [
                { clusterArn: SANDBOX_CLUSTER, serviceArn: SANDBOX_SERVICE, serviceName: 'food-api', desiredCount: 0 },
            ],
            ec2: [],
            ssm: new Map(),
            calls: { rdsStop: [], rdsStart: [], ecsUpdate: [], ec2Stop: [], ec2Start: [] },
        };
        const summary = await runSchedulerAction('start', makeClients(state));

        expect(state.calls.ecsUpdate).toEqual([]);
        expect(summary.ecs.skipped).toEqual([SANDBOX_SERVICE]);
        expect(summary.errors.some((message) => message.includes('no stored prior desired count'))).toBe(true);
    });

    it('records a non-fatal error and continues when an RDS start throws', async () => {
        const state: FakeState = {
            rdsInstances: [{ identifier: 'kitchensink-data-sandbox', status: 'stopped' }],
            clusters: [],
            services: [],
            ec2: [],
            ssm: new Map(),
            calls: { rdsStop: [], rdsStart: [], ecsUpdate: [], ec2Stop: [], ec2Start: [] },
        };
        const clients = makeClients(state);
        const failing: SchedulerClients = {
            ...clients,
            rds: {
                ...clients.rds,
                startInstance: async () => {
                    throw new Error('InvalidDBInstanceState: cannot start while modifying');
                },
            },
        };
        const summary = await runSchedulerAction('start', failing);

        expect(summary.rds.acted).toEqual([]);
        expect(summary.rds.skipped).toEqual(['kitchensink-data-sandbox']);
        expect(summary.errors[0]).toContain('cannot start while modifying');
    });
});
