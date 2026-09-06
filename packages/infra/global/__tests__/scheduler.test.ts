/**
 * ADR-0007 sandbox scheduler decision logic: selects ONLY sandbox resources (prod is never targeted),
 * persists ECS desired counts on stop, and restores them from the stored value on start (never a
 * hardcoded count). Skips resources already in the target state.
 */
import { describe, it, expect } from 'vitest';

import {
    isSandboxClusterArn,
    isScheduledCluster,
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
            listClusters: async () => state.clusters.map((arn) => ({ arn })),
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
const PER_PR_CLUSTER = 'arn:aws:ecs:us-east-1:111:cluster/kitchensink-food-service-pr-91-Cluster';
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

    describe('isScheduledCluster — which clusters the nightly window may touch', () => {
        // ⛔ THE GAP THIS CLOSES, measured on 2026-09-06. The selector matched a cluster only by the
        // substring `sandbox` in its NAME. A per-PR preview is stage-named `pr-{N}`, never `sandbox`, so
        // `kitchensink-food-service-pr-91-…` was invisible to it while
        // `kitchensink-identity-service-sandbox-…` went to zero on time. The per-PR services then kept
        // serving after their platform slept — and at 04:06:59 the shared RDS stopped underneath them,
        // so `e2e-seed reset` took a 500 from `recipe-pr-91` at 04:08:44 and the whole heavy tier reddened.
        // Cost was only half of it; the other half was serving errors for nine hours a night.
        //
        // ⛔ SELECTED BY TAG, NEVER BY NAME. `ecs-quiesce.sh` states the rule for per-PR ECS discovery:
        // the cluster NAME "is deliberately NOT used for matching… loosening that rule is exactly what
        // ADR-0005 forbids". `Environment=pr-{N}` is the same authority that licenses
        // `teardown-sandbox-pr.sh` to delete whole stacks, so this widens nothing.
        it('selects a sandbox cluster by name, as before', () => {
            expect(isScheduledCluster({ arn: SANDBOX_CLUSTER })).toBe(true);
        });

        it('⛔ selects a per-PR cluster by its Environment TAG, which the name match could never see', () => {
            expect(isScheduledCluster({ arn: PER_PR_CLUSTER, environmentTag: 'pr-91' })).toBe(true);
        });

        it('⛔ NEVER selects production — by name or by tag', () => {
            // The scheduler scales services to ZERO. A false positive here is a production outage, so both
            // doors are pinned: prod's name carries no `sandbox`, and its Environment tag is `global` —
            // the SAME tag the shared sandbox identity cluster carries, which is why the tag alone can
            // never be the selector.
            expect(isScheduledCluster({ arn: PROD_CLUSTER, environmentTag: 'global' })).toBe(false);
            expect(isScheduledCluster({ arn: PROD_CLUSTER })).toBe(false);
            expect(isScheduledCluster({ arn: PROD_CLUSTER, environmentTag: 'pr-91' })).toBe(false);
        });

        it('⚠️ refuses an Environment tag that merely starts with `pr`', () => {
            // `prod`, `preview`, `pr-` with nothing after it. The token must be `pr-` plus digits and
            // nothing else — the delimiter-aware discipline `pr-scope.sh` already enforces for teardown.
            for (const tag of ['prod', 'preview', 'pr-', 'pr-91x', 'xpr-91', 'PR-91', '']) {
                expect(isScheduledCluster({ arn: PER_PR_CLUSTER, environmentTag: tag }), tag).toBe(false);
            }
        });
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
