/**
 * ADR-0007 / ADR-0060 sandbox scheduler decision logic.
 *
 * - Selects ONLY sandbox resources (prod is never targeted), persists ECS desired counts on stop, and restores them
 *   from the stored value on start (never a hardcoded count).
 * - `start` is PER PR (ADR-0060): the shared tier plus exactly that PR's services, never every preview.
 * - `sync` is the only writer of a scheduled rule's state, driven by the pure `desiredRuleStates`.
 * - `stop` turns every scheduled rule off BEFORE it stops anything, so no job runs against a stopping tier.
 * - `stop` then starts the midnight reclaim (ADR-0061) LAST, under an idempotency name taken from the schedule's
 *   own `scheduledTime`. A reclaim that cannot start never undoes the stop: cost safety first, and the run fails
 *   afterwards so the failure is announced.
 */
import { describe, it, expect } from 'vitest';

import {
    assertRunSucceeded,
    desiredRuleStates,
    isSchedulerRunFailedError,
    isSandboxClusterArn,
    isScheduledCluster,
    isSandboxRdsInstance,
    parseSchedulerRequest,
    previewTokenOf,
    priorCountParamName,
    reclaimExecutionName,
    runSchedulerAction,
    selectRdsTargets,
    selectSandboxNatInstances,
    SCHEDULED_RULE_STAGE_TAG,
    type Ec2InstanceSummary,
    type EcsServiceSummary,
    type RdsInstanceSummary,
    type RuleDecision,
    type ScheduledRuleSummary,
    type SchedulerClients,
    type SchedulerRequest,
    type TierState,
} from '../lib/sandbox-scheduler/scheduler.js';
import { isInvalidSchedulerRequestError } from '../lib/sandbox-scheduler/invalidSchedulerRequestError.js';

/** A scheduled rule the fake account holds, with the state the last writer left it in. */
interface FakeRule extends ScheduledRuleSummary {
    state: 'ENABLED' | 'DISABLED';
}

/** A recording fake set of clients for orchestration tests. */
interface FakeState {
    readonly rdsInstances: RdsInstanceSummary[];
    readonly clusters: string[];
    /** Each cluster's `Environment` tag, when it carries one. */
    readonly clusterTags: Record<string, string>;
    readonly services: EcsServiceSummary[];
    readonly ec2: Ec2InstanceSummary[];
    readonly ssm: Map<string, string>;
    readonly rules: FakeRule[];
    /** Every mutating call, in the order it was made. */
    readonly log: string[];
    /** The execution names the reclaim loop was started under. */
    readonly reclaimStarts: string[];
    /** When set, starting the reclaim throws this error instead. */
    reclaimError?: Error;
    readonly calls: {
        rdsStop: string[];
        rdsStart: string[];
        ecsUpdate: Array<{ service: string; desiredCount: number }>;
        ec2Stop: string[];
        ec2Start: string[];
    };
}

/** A fresh fake account, overridden per test. */
function makeState(overrides: Partial<FakeState> = {}): FakeState {
    return {
        rdsInstances: [],
        clusters: [],
        clusterTags: {},
        services: [],
        ec2: [],
        ssm: new Map(),
        rules: [],
        log: [],
        reclaimStarts: [],
        calls: { rdsStop: [], rdsStart: [], ecsUpdate: [], ec2Stop: [], ec2Start: [] },
        ...overrides,
    };
}

function makeClients(state: FakeState): SchedulerClients {
    return {
        rds: {
            listInstances: async () => state.rdsInstances,
            stopInstance: async (id) => {
                state.calls.rdsStop.push(id);
                state.log.push(`rds:stop:${id}`);
            },
            startInstance: async (id) => {
                state.calls.rdsStart.push(id);
                state.log.push(`rds:start:${id}`);
            },
        },
        ecs: {
            listClusters: async () => state.clusters.map((arn) => ({ arn, environmentTag: state.clusterTags[arn] })),
            listServices: async (clusterArn) => state.services.filter((s) => s.clusterArn === clusterArn),
            updateDesiredCount: async (_clusterArn, serviceArn, desiredCount) => {
                state.calls.ecsUpdate.push({ service: serviceArn, desiredCount });
                state.log.push(`ecs:${desiredCount}:${serviceArn}`);
            },
        },
        ec2: {
            listInstances: async () => state.ec2,
            stopInstances: async (ids) => {
                state.calls.ec2Stop.push(...ids);
                state.log.push(`ec2:stop:${ids.join(',')}`);
            },
            startInstances: async (ids) => {
                state.calls.ec2Start.push(...ids);
                state.log.push(`ec2:start:${ids.join(',')}`);
            },
        },
        ssm: {
            getParameter: async (name) => state.ssm.get(name),
            putParameter: async (name, value) => {
                state.ssm.set(name, value);
            },
        },
        reclaim: {
            startLoop: async (executionName) => {
                state.log.push(`reclaim:start:${executionName}`);

                if (state.reclaimError !== undefined) {
                    throw state.reclaimError;
                }

                state.reclaimStarts.push(executionName);
            },
        },
        events: {
            listScheduledRules: async () =>
                state.rules.map(({ name, stageTag, environmentTag }) => ({ name, stageTag, environmentTag })),
            enableRule: async (name) => {
                const rule = state.rules.find((candidate) => candidate.name === name);

                if (rule) {
                    rule.state = 'ENABLED';
                }

                state.log.push(`rule:enable:${name}`);
            },
            disableRule: async (name) => {
                const rule = state.rules.find((candidate) => candidate.name === name);

                if (rule) {
                    rule.state = 'DISABLED';
                }

                state.log.push(`rule:disable:${name}`);
            },
        },
    };
}

const SANDBOX_CLUSTER = 'arn:aws:ecs:us-east-1:111:cluster/kitchensink-identity-service-sandbox-Cluster';
const PROD_CLUSTER = 'arn:aws:ecs:us-east-1:111:cluster/kitchensink-food-service-prod-Cluster';
const PER_PR_CLUSTER = 'arn:aws:ecs:us-east-1:111:cluster/kitchensink-food-service-pr-91-Cluster';
const SANDBOX_SERVICE = `arn:aws:ecs:us-east-1:111:service/${SANDBOX_CLUSTER.split('/').pop()}/identity`;

/** A per-PR cluster and its one service, tagged the way the CDK apps tag a preview. */
function previewCluster(
    pr: number,
    desiredCount: number,
): {
    readonly arn: string;
    readonly tag: string;
    readonly service: EcsServiceSummary;
} {
    const arn = `arn:aws:ecs:us-east-1:111:cluster/kitchensink-recipe-service-pr-${pr}-Cluster`;

    return {
        arn,
        tag: `pr-${pr}-sandbox`,
        service: {
            clusterArn: arn,
            serviceArn: `arn:aws:ecs:us-east-1:111:service/kitchensink-recipe-service-pr-${pr}-Cluster/recipe-api`,
            serviceName: 'recipe-api',
            desiredCount,
        },
    };
}

const UP_RDS: RdsInstanceSummary = { identifier: 'kitchensink-data-sandbox', status: 'available' };
const UP_NAT: Ec2InstanceSummary = {
    instanceId: 'i-sbx-nat',
    state: 'running',
    nameTag: 'kitchensink-network-sandbox/Vpc',
    sourceDestCheck: false,
};

/** A scheduled rule as the account reports it. */
function rule(name: string, stageTag: string | undefined, state: 'ENABLED' | 'DISABLED' = 'DISABLED'): FakeRule {
    return { name, stageTag, environmentTag: stageTag?.startsWith('pr-') ? `${stageTag}-sandbox` : 'sandbox', state };
}

/** A per-PR start, built the only way one can be: through the parser, which brands the PR token. */
function startFor(stage: string): SchedulerRequest {
    return parseSchedulerRequest({ action: 'start', stage });
}

describe('resource selectors (sandbox-only)', () => {
    it('matches only -sandbox RDS instances', () => {
        expect(isSandboxRdsInstance('kitchensink-data-sandbox')).toBe(true);
        expect(isSandboxRdsInstance('kitchensink-data-prod')).toBe(false);
    });

    // ADR-0061 review (N7): `-sandbox` alone matched another application's instance. The real instance identifier is
    // `kitchensink-data-sandbox-databaseb269d8bb-…`, so the repository prefix costs it nothing.
    it.each([
        ['kitchensink-data-sandbox-databaseb269d8bb-abcdef123456', true],
        ['armoury-sandbox-db', false],
        ['xkitchensink-data-sandbox', false],
        ['data-sandbox', false],
    ])('⛔ RDS instance %s is ours: %s', (identifier, ours) => {
        expect(isSandboxRdsInstance(identifier)).toBe(ours);
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
        // `kitchensink-food-service-pr-91-…` was invisible to it while the shared tier went to zero on time.
        //
        // ⛔ SELECTED BY TAG, NEVER BY NAME. `ecsQuiesce.sh` states the rule for per-PR ECS discovery: the
        // cluster NAME "is deliberately NOT used for matching… loosening that rule is exactly what ADR-0005
        // forbids".
        it('selects a sandbox cluster by name, as before', () => {
            expect(isScheduledCluster({ arn: SANDBOX_CLUSTER })).toBe(true);
        });

        // BOTH spellings: a preview deployed before the tagging scheme changed carries the bare token.
        it.each(['pr-91-sandbox', 'pr-91'])(
            '⛔ selects a per-PR cluster by its Environment TAG %s, which the name match could never see',
            (environmentTag) => {
                expect(isScheduledCluster({ arn: PER_PR_CLUSTER, environmentTag })).toBe(true);
            },
        );

        // ⛔ ADR-0061 security review (B1). The account also hosts another application, and a tag alone does not say whose
        // cluster this is: `ecs:DeleteService` is irreversible, so a per-PR cluster must ALSO be named for this
        // repository. Both doors are fired at a foreign cluster that carries a perfectly valid per-PR tag.
        it.each([
            'arn:aws:ecs:us-east-1:111:cluster/armoury-api-pr-91-Cluster',
            'arn:aws:ecs:us-east-1:111:cluster/xkitchensink-food-service-pr-91-Cluster',
            'arn:aws:ecs:us-east-1:111:cluster/not-kitchensink-pr-91',
        ])('⛔ never selects the foreign cluster %s, whatever tag it carries', (arn) => {
            for (const environmentTag of ['pr-91-sandbox', 'pr-91']) {
                expect(isScheduledCluster({ arn, environmentTag })).toBe(false);
                expect(previewTokenOf({ arn, environmentTag })).toBeUndefined();
            }
        });

        it('still reads the token of a kitchensink- cluster', () => {
            expect(previewTokenOf({ arn: PER_PR_CLUSTER, environmentTag: 'pr-91-sandbox' })).toBe('pr-91');
        });

        it('⛔ NEVER selects production — by name or by tag', () => {
            expect(isScheduledCluster({ arn: PROD_CLUSTER, environmentTag: 'production' })).toBe(false);
            expect(isScheduledCluster({ arn: PROD_CLUSTER })).toBe(false);
            expect(isScheduledCluster({ arn: PROD_CLUSTER, environmentTag: 'pr-91-sandbox' })).toBe(false);
        });

        it('⚠️ refuses an Environment tag that merely starts with `pr`, or merely ends in `-sandbox`', () => {
            const refused = ['prod', 'preview', 'pr-', 'pr-91x', 'xpr-91', 'PR-91', '', 'sandbox', 'production'];

            for (const tag of [...refused, 'pr-91-sandbox-extra', 'pr-sandbox', 'prod-sandbox']) {
                expect(isScheduledCluster({ arn: PER_PR_CLUSTER, environmentTag: tag }), tag).toBe(false);
            }
        });
    });

    it('selects only the sandbox NAT instance (source/dest check disabled + sandbox Name tag)', () => {
        const instances: Ec2InstanceSummary[] = [
            UP_NAT,
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
            `/kitchensink/sandbox-scheduler/ecs/${SANDBOX_CLUSTER.split('/').pop()}/identity`,
        );
    });
});

describe('parseSchedulerRequest — the event is parsed, never defaulted', () => {
    it.each<[unknown, unknown]>([
        [{ action: 'stop' }, { action: 'stop' }],
        [
            { action: 'stop', scheduledTime: '2026-10-13T04:00:00Z' },
            { action: 'stop', scheduledTime: '2026-10-13T04:00:00Z' },
        ],
        // A scheduledTime that is not a string is dropped, never trusted: the stop must still run.
        [{ action: 'stop', scheduledTime: 5 }, { action: 'stop' }],
        [{ action: 'sync' }, { action: 'sync' }],
        [
            { action: 'start', stage: 'pr-7' },
            { action: 'start', stage: 'pr-7' },
        ],
        [
            { action: 'start', stage: 'pr-1234' },
            { action: 'start', stage: 'pr-1234' },
        ],
    ])('accepts %j', (event, expected) => {
        expect(parseSchedulerRequest(event)).toEqual(expected);
    });

    // ⛔ A start with no stage USED to mean "start every cluster". ADR-0060 removed that door: a start is for ONE PR,
    // so the only thing a stage-less start can be is the old behaviour arriving by mistake.
    it.each<unknown>([
        { action: 'start' },
        { action: 'start', stage: 'sandbox' },
        { action: 'start', stage: 'prod' },
        { action: 'start', stage: 'pr-' },
        { action: 'start', stage: 'pr-07' },
        { action: 'start', stage: 'pr-7-sandbox' },
        { action: 'start', stage: ' pr-7' },
        { action: 'start', stage: 7 },
        { action: 'restart' },
        { action: 'STOP' },
        {},
        null,
        'stop',
    ])('refuses %j', (event) => {
        let thrown: unknown;

        try {
            parseSchedulerRequest(event);
        } catch (error) {
            thrown = error;
        }

        expect(isInvalidSchedulerRequestError(thrown)).toBe(true);
    });
});

describe('desiredRuleStates — the truth table (ADR-0060)', () => {
    const SHARED = rule('kitchensink-identity-webh-QueueCheckSchedule-a', 'sandbox');
    const PR7 = rule('kitchensink-recipe-worker-QueueCheckSchedule-b', 'pr-7');
    const PR8 = rule('kitchensink-recipe-band-drain-pr-8', 'pr-8');
    const RULES = [SHARED, PR7, PR8];

    /** The decided state per rule name, or `refused`. */
    function decided(tier: TierState, rules: readonly ScheduledRuleSummary[] = RULES): Record<string, string> {
        return Object.fromEntries(
            desiredRuleStates(rules, tier).map((decision: RuleDecision) => [
                decision.rule.name,
                decision.kind === 'refused' ? 'refused' : decision.desired,
            ]),
        );
    }

    const tier = (rdsAvailable: boolean, natRunning: boolean, ...up: string[]): TierState => ({
        rdsAvailable,
        natRunning,
        upStages: new Set(up),
    });

    it.each<[string, TierState, Record<string, string>]>([
        [
            'everything up, pr-7 serving: pr-7 and the shared rules run, pr-8 does not',
            tier(true, true, 'pr-7'),
            { [SHARED.name]: 'ENABLED', [PR7.name]: 'ENABLED', [PR8.name]: 'DISABLED' },
        ],
        [
            'both PRs serving: every rule runs',
            tier(true, true, 'pr-7', 'pr-8'),
            { [SHARED.name]: 'ENABLED', [PR7.name]: 'ENABLED', [PR8.name]: 'ENABLED' },
        ],
        [
            'database stopped: nothing runs, whoever is serving',
            tier(false, true, 'pr-7', 'pr-8'),
            { [SHARED.name]: 'DISABLED', [PR7.name]: 'DISABLED', [PR8.name]: 'DISABLED' },
        ],
        [
            'NAT stopped: nothing runs, whoever is serving',
            tier(true, false, 'pr-7', 'pr-8'),
            { [SHARED.name]: 'DISABLED', [PR7.name]: 'DISABLED', [PR8.name]: 'DISABLED' },
        ],
        [
            'tier up but no PR serving: the shared rules have nothing to serve either',
            tier(true, true),
            { [SHARED.name]: 'DISABLED', [PR7.name]: 'DISABLED', [PR8.name]: 'DISABLED' },
        ],
    ])('%s', (_case, state, expected) => {
        expect(decided(state)).toEqual(expected);
    });

    it('⛔ a token is matched EXACTLY: pr-1 serving does not enable pr-15', () => {
        const pr15 = rule('kitchensink-recipe-band-drain-pr-15', 'pr-15');

        expect(decided(tier(true, true, 'pr-1'), [pr15])).toEqual({ [pr15.name]: 'DISABLED' });
    });

    it('⛔ refuses a rule whose Environment tag says production, whatever its stage tag claims', () => {
        // The interlock comes FIRST. A mis-tag that put a preview's stage tag on a production rule must not
        // switch a production sweeper off (or on); the cost of a wrong answer here is production behaviour.
        const mistagged: ScheduledRuleSummary = {
            name: 'kitchensink-recipe-worker-QueueCheck-x',
            stageTag: 'pr-7',
            environmentTag: 'production',
        };

        expect(decided(tier(true, true, 'pr-7'), [mistagged])).toEqual({ [mistagged.name]: 'refused' });
    });

    it.each(['kitchensink-recipe-erasure-sweep-prod', 'kitchensink-food-prod-IngestionScheduled-y'])(
        '⛔ refuses a rule NAMED for production even when it carries a preview stage tag (%s)',
        (name) => {
            const candidate: ScheduledRuleSummary = { name, stageTag: 'pr-7', environmentTag: 'pr-7-sandbox' };

            expect(decided(tier(true, true, 'pr-7'), [candidate])).toEqual({ [name]: 'refused' });
        },
    );

    it.each(['dev', 'production', 'prod', 'pr-7-sandbox', 'PR-7', ''])(
        'refuses a stage tag that names no population it owns (%j)',
        (stageTag) => {
            const candidate: ScheduledRuleSummary = { name: 'kitchensink-x', stageTag, environmentTag: 'sandbox' };

            expect(decided(tier(true, true, 'pr-7'), [candidate])).toEqual({ [candidate.name]: 'refused' });
        },
    );

    it('ignores a rule that carries no stage tag at all: the scheduler never owned it', () => {
        const untagged: ScheduledRuleSummary = {
            name: 'kitchensink-food-service--Ingestion-z',
            stageTag: undefined,
            environmentTag: 'production',
        };

        expect(desiredRuleStates([untagged], tier(true, true, 'pr-7'))).toEqual([]);
    });

    it('names the tag the CDK apps stamp, which the IAM condition also keys on', () => {
        expect(SCHEDULED_RULE_STAGE_TAG).toBe('SandboxStage');
    });
});

describe('runSchedulerAction — sync', () => {
    /** A sandbox with the database and NAT up and the given previews deployed. */
    function liveSandbox(previews: ReturnType<typeof previewCluster>[], rules: FakeRule[]): FakeState {
        return makeState({
            rdsInstances: [UP_RDS],
            ec2: [UP_NAT],
            clusters: [SANDBOX_CLUSTER, ...previews.map((preview) => preview.arn)],
            clusterTags: Object.fromEntries(previews.map((preview) => [preview.arn, preview.tag])),
            services: previews.map((preview) => preview.service),
            rules,
        });
    }

    it('enables the rules of the PR that is serving and of the shared tier, and disables the rest', async () => {
        const state = liveSandbox(
            [previewCluster(7, 1), previewCluster(8, 0)],
            [rule('shared-q', 'sandbox'), rule('pr7-q', 'pr-7'), rule('pr8-q', 'pr-8', 'ENABLED')],
        );

        const summary = await runSchedulerAction({ action: 'sync' }, makeClients(state));

        expect(Object.fromEntries(state.rules.map((r) => [r.name, r.state]))).toEqual({
            'shared-q': 'ENABLED',
            'pr7-q': 'ENABLED',
            'pr8-q': 'DISABLED',
        });
        expect(summary.errors).toEqual([]);
        // Sync reads; it never starts or stops a resource.
        expect(state.calls).toEqual({ rdsStop: [], rdsStart: [], ecsUpdate: [], ec2Stop: [], ec2Start: [] });
    });

    it('⛔ re-enables the rules a redeploy reset to DISABLED (CloudFormation re-applies State on every update)', async () => {
        const state = liveSandbox([previewCluster(7, 1)], [rule('shared-q', 'sandbox'), rule('pr7-q', 'pr-7')]);
        const clients = makeClients(state);

        await runSchedulerAction({ action: 'sync' }, clients);

        // The redeploy: CloudFormation writes the template's DISABLED back over what sync enabled.
        for (const deployed of state.rules) {
            deployed.state = 'DISABLED';
        }

        await runSchedulerAction({ action: 'sync' }, clients);

        expect(state.rules.map((r) => r.state)).toEqual(['ENABLED', 'ENABLED']);
    });

    it('turns every rule off once the database is stopped, even with a preview still scaled up', async () => {
        const state = liveSandbox(
            [previewCluster(7, 1)],
            [rule('shared-q', 'sandbox', 'ENABLED'), rule('pr7-q', 'pr-7', 'ENABLED')],
        );
        state.rdsInstances[0] = { identifier: 'kitchensink-data-sandbox', status: 'stopped' };

        await runSchedulerAction({ action: 'sync' }, makeClients(state));

        expect(state.rules.map((r) => r.state)).toEqual(['DISABLED', 'DISABLED']);
    });

    it('⛔ FAILS when stages are serving and discovery finds no owned rule at all — a blind sync is not a pass', async () => {
        // Rules left DISABLED behind a green sync is the queue watcher silently off while the preview is up. Every
        // preview deploys recipe-workers and the shared tier deploys the webhooks, so "nothing owned" while anything
        // serves means the discovery itself is blind (wrong prefix, lost permission, a gate that stopped tagging).
        const state = liveSandbox([previewCluster(7, 1)], [rule('kitchensink-food-untagged', undefined)]);

        const summary = await runSchedulerAction({ action: 'sync' }, makeClients(state));

        expect(summary.errors.some((message) => message.includes('no scheduled rule'))).toBe(true);
    });

    it('WARNS — and names the stage — when one serving stage owns no rule while others do', async () => {
        // A preview deployed before ADR-0060 carries untagged rules until its next deploy, which Sandbox Up performs.
        // That gap is reported on every run until it closes, but it must not fail the run that is closing it.
        const state = liveSandbox([previewCluster(7, 1)], [rule('shared-q', 'sandbox')]);

        const summary = await runSchedulerAction({ action: 'sync' }, makeClients(state));

        expect(summary.errors).toEqual([]);
        expect(summary.warnings).toEqual([expect.stringContaining('pr-7')]);
    });

    it('records a refused rule as an error and never writes it', async () => {
        const state = liveSandbox(
            [previewCluster(7, 1)],
            [
                rule('pr7-q', 'pr-7'),
                {
                    name: 'kitchensink-recipe-erasure-sweep-prod',
                    stageTag: 'pr-7',
                    environmentTag: 'production',
                    state: 'ENABLED',
                },
            ],
        );

        const summary = await runSchedulerAction({ action: 'sync' }, makeClients(state));

        expect(state.log.filter((entry) => entry.includes('-prod'))).toEqual([]);
        expect(summary.errors.some((message) => message.includes('kitchensink-recipe-erasure-sweep-prod'))).toBe(true);
    });

    it('records a rule write that fails and carries on with the others', async () => {
        const state = liveSandbox([previewCluster(7, 1)], [rule('shared-q', 'sandbox'), rule('pr7-q', 'pr-7')]);
        const clients = makeClients(state);
        const failing: SchedulerClients = {
            ...clients,
            events: {
                ...clients.events,
                enableRule: async (name) => {
                    if (name === 'shared-q') {
                        throw new Error('AccessDeniedException');
                    }

                    await clients.events.enableRule(name);
                },
            },
        };

        const summary = await runSchedulerAction({ action: 'sync' }, failing);

        expect(state.rules.find((r) => r.name === 'pr7-q')?.state).toBe('ENABLED');
        expect(summary.rules.skipped).toEqual(['shared-q']);
        expect(summary.errors[0]).toContain('AccessDeniedException');
    });
});

describe('runSchedulerAction — stop', () => {
    it('stops sandbox RDS + NAT, and persists-then-zeroes sandbox ECS desired counts (prod untouched)', async () => {
        const state = makeState({
            rdsInstances: [UP_RDS, { identifier: 'kitchensink-data-prod', status: 'available' }],
            clusters: [SANDBOX_CLUSTER, PROD_CLUSTER],
            services: [
                { clusterArn: SANDBOX_CLUSTER, serviceArn: SANDBOX_SERVICE, serviceName: 'identity', desiredCount: 3 },
                {
                    clusterArn: PROD_CLUSTER,
                    serviceArn: 'arn:aws:ecs:us-east-1:111:service/prod/identity',
                    serviceName: 'identity',
                    desiredCount: 2,
                },
            ],
            ec2: [{ instanceId: 'i-sbx-nat', state: 'running', nameTag: 'net-sandbox', sourceDestCheck: false }],
        });
        const summary = await runSchedulerAction({ action: 'stop' }, makeClients(state));

        expect(state.calls.rdsStop).toEqual(['kitchensink-data-sandbox']);
        expect(state.calls.ec2Stop).toEqual(['i-sbx-nat']);
        expect(state.calls.ecsUpdate).toEqual([{ service: SANDBOX_SERVICE, desiredCount: 0 }]);
        expect(state.ssm.get(priorCountParamName(SANDBOX_SERVICE))).toBe('3');
        expect(summary.errors).toEqual([]);
    });

    it('⛔ never scales a FOREIGN cluster to zero, even one that carries a valid per-PR tag', async () => {
        const foreign = 'arn:aws:ecs:us-east-1:111:cluster/armoury-api-pr-91-Cluster';
        const state = makeState({
            clusters: [foreign],
            clusterTags: { [foreign]: 'pr-91-sandbox' },
            services: [
                {
                    clusterArn: foreign,
                    serviceArn: `${foreign.replace('cluster/', 'service/')}/api`,
                    serviceName: 'api',
                    desiredCount: 2,
                },
            ],
        });

        await runSchedulerAction({ action: 'stop' }, makeClients(state));

        expect(state.calls.ecsUpdate).toEqual([]);
    });

    it('skips an ECS service already scaled to zero', async () => {
        const state = makeState({
            clusters: [SANDBOX_CLUSTER],
            services: [
                { clusterArn: SANDBOX_CLUSTER, serviceArn: SANDBOX_SERVICE, serviceName: 'identity', desiredCount: 0 },
            ],
        });
        const summary = await runSchedulerAction({ action: 'stop' }, makeClients(state));

        expect(state.calls.ecsUpdate).toEqual([]);
        expect(summary.ecs.skipped).toEqual([SANDBOX_SERVICE]);
    });

    it('⛔ disables EVERY scheduled rule before it stops a single resource', async () => {
        // At midnight everything is still up, so a sync computed from the live tier would answer ENABLED. Stop
        // projects the tier it is ABOUT to produce, and switches the jobs off first, so no sweeper or queue check
        // runs against a database that is shutting down underneath it.
        const preview = previewCluster(7, 1);
        const state = makeState({
            rdsInstances: [UP_RDS],
            ec2: [UP_NAT],
            clusters: [SANDBOX_CLUSTER, preview.arn],
            clusterTags: { [preview.arn]: preview.tag },
            services: [preview.service],
            rules: [rule('shared-q', 'sandbox', 'ENABLED'), rule('pr7-q', 'pr-7', 'ENABLED')],
        });

        const summary = await runSchedulerAction({ action: 'stop' }, makeClients(state));

        const firstStop = state.log.findIndex((entry) => !entry.startsWith('rule:'));
        const lastDisable = state.log.map((entry) => entry.startsWith('rule:disable:')).lastIndexOf(true);

        expect(state.rules.map((r) => r.state)).toEqual(['DISABLED', 'DISABLED']);
        expect(lastDisable).toBeGreaterThanOrEqual(0);
        expect(lastDisable).toBeLessThan(firstStop);
        expect(state.log.some((entry) => entry.startsWith('rule:enable:'))).toBe(false);
        expect(summary.rules.acted).toEqual(['shared-q', 'pr7-q']);
    });

    it('still stops the tier when a rule cannot be disabled, and reports it', async () => {
        const state = makeState({ rdsInstances: [UP_RDS], rules: [rule('shared-q', 'sandbox', 'ENABLED')] });
        const clients = makeClients(state);
        const failing: SchedulerClients = {
            ...clients,
            events: {
                ...clients.events,
                disableRule: async () => {
                    throw new Error('ThrottlingException');
                },
            },
        };

        const summary = await runSchedulerAction({ action: 'stop' }, failing);

        expect(state.calls.rdsStop).toEqual(['kitchensink-data-sandbox']);
        expect(summary.errors[0]).toContain('ThrottlingException');
    });
});

describe('reclaimExecutionName — the idempotency key of the midnight reclaim (ADR-0061)', () => {
    it('is built from the schedule`s own time, with the colons a name cannot hold replaced', () => {
        expect(reclaimExecutionName('2026-10-13T04:00:00Z')).toBe('nightly-2026-10-13T04-00-00Z');
    });

    it('is the same name for the same scheduled time and a different one for another night', () => {
        expect(reclaimExecutionName('2026-10-13T04:00:00Z')).toBe(reclaimExecutionName('2026-10-13T04:00:00Z'));
        expect(reclaimExecutionName('2026-10-14T04:00:00Z')).not.toBe(reclaimExecutionName('2026-10-13T04:00:00Z'));
    });

    it.each([
        '',
        'tomorrow',
        '2026-10-13',
        '2026-10-13T04:00:00',
        '2026-10-13T00:00:00-04:00',
        '2026-10-13T04:00:00.000Z',
        ' 2026-10-13T04:00:00Z',
        '2026-10-13T04:00:00Z; rm',
        '2026-10-13T04:00:00Z/../x',
        `${'2026-10-13T04:00:00Z'}\n`,
    ])('refuses %j, because it becomes an execution name', (value) => {
        expect(reclaimExecutionName(value)).toBeUndefined();
    });
});

describe('runSchedulerAction — stop starts the midnight reclaim LAST (ADR-0061)', () => {
    const SCHEDULED = '2026-10-13T04:00:00Z';
    const NAME = 'nightly-2026-10-13T04-00-00Z';

    /** A sandbox with something to stop in every class, so "after all of them" is a real ordering. */
    function runningSandbox(): FakeState {
        const preview = previewCluster(7, 1);

        return makeState({
            rdsInstances: [UP_RDS],
            ec2: [UP_NAT],
            clusters: [SANDBOX_CLUSTER, preview.arn],
            clusterTags: { [preview.arn]: preview.tag },
            services: [
                { clusterArn: SANDBOX_CLUSTER, serviceArn: SANDBOX_SERVICE, serviceName: 'identity', desiredCount: 1 },
                preview.service,
            ],
            rules: [rule('pr7-q', 'pr-7', 'ENABLED')],
        });
    }

    it('starts the loop under the name taken from scheduledTime, after the rules, RDS, ECS and NAT', async () => {
        const state = runningSandbox();
        const summary = await runSchedulerAction({ action: 'stop', scheduledTime: SCHEDULED }, makeClients(state));

        expect(state.reclaimStarts).toEqual([NAME]);
        expect(state.log.at(-1)).toBe(`reclaim:start:${NAME}`);
        expect(state.log.slice(0, -1).some((entry) => entry.startsWith('rds:stop:'))).toBe(true);
        expect(state.log.slice(0, -1).some((entry) => entry.startsWith('ecs:0:'))).toBe(true);
        expect(state.log.slice(0, -1).some((entry) => entry.startsWith('ec2:stop:'))).toBe(true);
        expect(summary.reclaim.acted).toEqual([NAME]);
        expect(summary.errors).toEqual([]);
    });

    it('⛔ treats ExecutionAlreadyExists as success: a retried schedule is the same night', async () => {
        const state = runningSandbox();
        const already = Object.assign(new Error('Execution Already Exists'), { name: 'ExecutionAlreadyExists' });

        state.reclaimError = already;

        const summary = await runSchedulerAction({ action: 'stop', scheduledTime: SCHEDULED }, makeClients(state));

        expect(summary.errors).toEqual([]);
        expect(() => assertRunSucceeded(summary)).not.toThrow();
    });

    it('⛔ a reclaim that cannot start never undoes the stop, and fails the run afterwards', async () => {
        const state = runningSandbox();

        state.reclaimError = new Error('AccessDeniedException: not authorized to perform states:StartExecution');

        const summary = await runSchedulerAction({ action: 'stop', scheduledTime: SCHEDULED }, makeClients(state));

        expect(state.calls.rdsStop).toEqual(['kitchensink-data-sandbox']);
        expect(state.calls.ec2Stop).toEqual(['i-sbx-nat']);
        expect(state.calls.ecsUpdate.map((call) => call.desiredCount)).toEqual([0, 0]);
        expect(summary.errors).toHaveLength(1);
        expect(summary.errors[0]).toContain('reclaim');
        expect(summary.errors[0]).toContain('AccessDeniedException');
        expect(() => assertRunSucceeded(summary)).toThrow();
    });

    it('another error that merely mentions the name is NOT mistaken for ExecutionAlreadyExists', async () => {
        const state = runningSandbox();

        state.reclaimError = new Error('ExecutionAlreadyExists-looking message from something else');

        const summary = await runSchedulerAction({ action: 'stop', scheduledTime: SCHEDULED }, makeClients(state));

        expect(summary.errors).toHaveLength(1);
    });

    it('with no scheduledTime (a hand-run stop) it stops everything, starts no reclaim, and says so', async () => {
        const state = runningSandbox();
        const summary = await runSchedulerAction({ action: 'stop' }, makeClients(state));

        expect(state.reclaimStarts).toEqual([]);
        expect(state.calls.rdsStop).toEqual(['kitchensink-data-sandbox']);
        expect(summary.errors).toEqual([]);
        expect(summary.warnings.join(' ')).toContain('reclaim');
    });

    it('a malformed scheduledTime still stops everything, starts no reclaim, and FAILS the run so it is announced', async () => {
        const state = runningSandbox();
        const summary = await runSchedulerAction({ action: 'stop', scheduledTime: 'not a time' }, makeClients(state));

        expect(state.reclaimStarts).toEqual([]);
        expect(state.calls.rdsStop).toEqual(['kitchensink-data-sandbox']);
        expect(summary.errors).toHaveLength(1);
        expect(summary.errors[0]).toContain('scheduledTime');
    });

    it('only a stop starts the reclaim: a start and a sync never do', async () => {
        const state = runningSandbox();
        const clients = makeClients(state);

        await runSchedulerAction({ action: 'sync' }, clients);
        await runSchedulerAction(startFor('pr-7'), clients);

        expect(state.log.some((entry) => entry.startsWith('reclaim:'))).toBe(false);
    });
});

describe('runSchedulerAction — per-PR start', () => {
    /** A stopped sandbox holding the shared tier plus previews 1, 7, 15 and 71, each with a recorded count. */
    function stoppedSandbox(): FakeState {
        const previews = [1, 7, 15, 71].map((pr) => previewCluster(pr, 0));

        return makeState({
            rdsInstances: [{ identifier: 'kitchensink-data-sandbox', status: 'stopped' }],
            ec2: [{ ...UP_NAT, state: 'stopped' }],
            clusters: [SANDBOX_CLUSTER, PROD_CLUSTER, ...previews.map((preview) => preview.arn)],
            clusterTags: {
                ...Object.fromEntries(previews.map((preview) => [preview.arn, preview.tag])),
                [PROD_CLUSTER]: 'production',
            },
            services: [
                { clusterArn: SANDBOX_CLUSTER, serviceArn: SANDBOX_SERVICE, serviceName: 'identity', desiredCount: 0 },
                {
                    clusterArn: PROD_CLUSTER,
                    serviceArn: 'arn:aws:ecs:us-east-1:111:service/prod/food-api',
                    serviceName: 'food-api',
                    desiredCount: 0,
                },
                ...previews.map((preview) => preview.service),
            ],
            ssm: new Map(
                [
                    SANDBOX_SERVICE,
                    'arn:aws:ecs:us-east-1:111:service/prod/food-api',
                    ...previews.map((p) => p.service.serviceArn),
                ].map((arn) => [priorCountParamName(arn), '2']),
            ),
        });
    }

    it('starts RDS, the NAT, the shared tier and ONLY that PR — not pr-1, pr-15, pr-71 or prod', async () => {
        const state = stoppedSandbox();

        const summary = await runSchedulerAction(startFor('pr-7'), makeClients(state));

        expect(state.calls.rdsStart).toEqual(['kitchensink-data-sandbox']);
        expect(state.calls.ec2Start).toEqual(['i-sbx-nat']);
        expect(state.calls.ecsUpdate).toEqual([
            { service: SANDBOX_SERVICE, desiredCount: 2 },
            { service: previewCluster(7, 0).service.serviceArn, desiredCount: 2 },
        ]);
        expect(summary.errors).toEqual([]);
    });

    it('⛔ exact token match: starting pr-1 does not start pr-15 or pr-71', async () => {
        const state = stoppedSandbox();

        await runSchedulerAction(startFor('pr-1'), makeClients(state));

        expect(state.calls.ecsUpdate.map((update) => update.service)).toEqual([
            SANDBOX_SERVICE,
            previewCluster(1, 0).service.serviceArn,
        ]);
    });

    it('never writes a rule — that is sync, at the end of Sandbox Up, once the deploys have landed', async () => {
        const state = stoppedSandbox();
        state.rules.push(rule('pr7-q', 'pr-7'));

        await runSchedulerAction(startFor('pr-7'), makeClients(state));

        expect(state.log.filter((entry) => entry.startsWith('rule:'))).toEqual([]);
    });

    it('skips a service with no stored prior count instead of guessing one', async () => {
        const state = makeState({
            clusters: [SANDBOX_CLUSTER],
            services: [
                { clusterArn: SANDBOX_CLUSTER, serviceArn: SANDBOX_SERVICE, serviceName: 'identity', desiredCount: 0 },
            ],
        });
        const summary = await runSchedulerAction(startFor('pr-7'), makeClients(state));

        expect(state.calls.ecsUpdate).toEqual([]);
        expect(summary.ecs.skipped).toEqual([SANDBOX_SERVICE]);
        expect(summary.errors.some((message) => message.includes('no stored prior desired count'))).toBe(true);
    });

    it('records a non-fatal error and continues when an RDS start throws', async () => {
        const state = makeState({ rdsInstances: [{ identifier: 'kitchensink-data-sandbox', status: 'stopped' }] });
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
        const summary = await runSchedulerAction(startFor('pr-7'), failing);

        expect(summary.rds.acted).toEqual([]);
        expect(summary.rds.skipped).toEqual(['kitchensink-data-sandbox']);
        expect(summary.errors[0]).toContain('cannot start while modifying');
    });
});

describe('assertRunSucceeded — a run with a failed step fails the invocation', () => {
    const summary = (errors: string[]) => ({
        action: 'start' as const,
        rds: { acted: [], skipped: [] },
        ecs: { acted: [], skipped: [] },
        nat: { acted: [], skipped: [] },
        rules: { acted: [], skipped: [] },
        reclaim: { acted: [], skipped: [] },
        warnings: ['pr-7 owns no scheduled rule'],
        errors,
    });

    it('passes a run with no errors, even one that carries warnings', () => {
        expect(() => {
            assertRunSucceeded(summary([]));
        }).not.toThrow();
    });

    it('⛔ fails a run whose database start was refused, naming the step, so Lambda counts it as an error', () => {
        let thrown: unknown;

        try {
            assertRunSucceeded(
                summary(['rds start kitchensink-data-sandbox-db: InsufficientDBInstanceCapacity in us-east-1a']),
            );
        } catch (error) {
            thrown = error;
        }

        expect(isSchedulerRunFailedError(thrown)).toBe(true);
        expect((thrown as Error).message).toContain('start');
        expect((thrown as Error).message).toContain('InsufficientDBInstanceCapacity');
    });
});
